// Attached documents: reading them (PDF, Word, PowerPoint, Excel, text, web pages and photos),
// and using them as context for the agent: a bounded excerpt for its briefing, and passage search
// over the full text for anything that didn't fit. Document text is always untrusted data.
// Office files are read with a small built-in ZIP reader; PDFs and photos go to a vision model
// when one is connected, with a built-in PDF text reader as the fallback. No extra packages.
import type { DocumentText } from "./types";
import { InputError } from "./errors";
import { foldText } from "./util";
import { isZip, listZip, zipText, type ZipEntry } from "./zip";

/** Reads a file the built-in readers can't (photos, scanned PDFs): returns its text. */
export interface DocumentReader {
  read(bytes: Uint8Array, mime: string, name: string, signal?: AbortSignal): Promise<string>;
}

export type RawFile = { name: string; type?: string | null; bytes: Uint8Array };

/** Hosting platforms cap request bodies around 4.5 MB. */
export const MAX_DOC_BYTES = 4 * 1024 * 1024;
export const MAX_DOC_CHARS = 60_000;

export type DocKind = "pdf" | "docx" | "pptx" | "xlsx" | "image" | "html" | "rtf" | "text";

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", heif: "image/heif", gif: "image/gif" };
const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? "";

/** What a file really is, from its first bytes (not just its name). Pure. */
export function sniffKind(b: Uint8Array, name: string, mime?: string | null): DocKind | "zip" | null {
  const head = (n: number) => String.fromCharCode(...b.subarray(0, n));
  if (head(5) === "%PDF-") return "pdf";
  if (isZip(b)) return "zip";
  if (b[0] === 0x89 && head(4).slice(1) === "PNG") return "image";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image";
  if (head(4) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") return "image";
  if (head(6) === "GIF87a" || head(6) === "GIF89a") return "image";
  if (String.fromCharCode(...b.subarray(4, 12)).match(/^ftyp(heic|heix|mif1|msf1|heif)/)) return "image";
  if (head(5) === "{\\rtf") return "rtf";
  // Text: no NUL bytes in the first few KB.
  const sample = b.subarray(0, 4096);
  if (sample.includes(0) && !(b[0] === 0xff && b[1] === 0xfe) && !(b[0] === 0xfe && b[1] === 0xff)) return null;
  const e = ext(name);
  if (e === "html" || e === "htm" || /html/.test(mime ?? "") || /^\s*<(!doctype html|html)/i.test(head(Math.min(200, b.length)))) return "html";
  return "text";
}

const decodeText = (b: Uint8Array) => {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  return new TextDecoder("utf-8").decode(b);
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", naira: "₦" };
/** Decode XML/HTML character references. Pure. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text from an HTML page: no scripts, styles or tags; blocks become lines. Pure. */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|table)>/gi, "\n")
      .replace(/<(td|th)[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, " ")
  );
}

/** Rough text from RTF: drop control words and groups like fonts and colours. Pure. */
export function rtfText(rtf: string): string {
  return rtf
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|\*)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "")
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "");
}

/** Text from a Word document's XML: paragraphs, tabs, breaks, table cells. Pure. */
export function wordXmlText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:(instrText|delText)[^>]*>[\s\S]*?<\/w:\1>/g, "")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:tc>/g, " | ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

/** Text from PowerPoint/Excel-style XML (<a:t>, <t>) with paragraph breaks. Pure. */
const drawingText = (xml: string) => decodeEntities(xml.replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, ""));

async function officeText(b: Uint8Array, entries: ZipEntry[]): Promise<{ kind: DocKind; text: string } | null> {
  const has = (n: string) => entries.some((e) => e.name === n);
  if (has("word/document.xml")) {
    const parts = ["word/document.xml", ...entries.map((e) => e.name).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n))];
    const texts = await Promise.all(parts.map(async (n) => wordXmlText((await zipText(b, entries, n)) ?? "")));
    return { kind: "docx", text: texts.join("\n") };
  }
  if (has("ppt/presentation.xml")) {
    const slides = entries
      .map((e) => e.name.match(/^ppt\/slides\/slide(\d+)\.xml$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .sort((x, y) => Number(x[1]) - Number(y[1]))
      .slice(0, 200);
    const texts = await Promise.all(slides.map(async (m) => `Slide ${m[1]}:\n${drawingText((await zipText(b, entries, m[0])) ?? "")}`));
    return { kind: "pptx", text: texts.join("\n\n") };
  }
  if (has("xl/workbook.xml")) {
    const shared = [...((await zipText(b, entries, "xl/sharedStrings.xml")) ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeEntities(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "").replace(/<[^>]+>/g, "")));
    const names = [...((await zipText(b, entries, "xl/workbook.xml")) ?? "").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
    const sheets = entries
      .map((e) => e.name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/))
      .filter((m): m is RegExpMatchArray => Boolean(m))
      .sort((x, y) => Number(x[1]) - Number(y[1]))
      .slice(0, 20);
    const out: string[] = [];
    for (const [i, m] of sheets.entries()) {
      const xml = (await zipText(b, entries, m[0])) ?? "";
      const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 2000).map((r) => {
        const cells = [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
          const attrs = c[1];
          const inner = c[2] ?? "";
          const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (/t="s"/.test(attrs) && v != null) return (shared[Number(v)] ?? "").trim();
          if (/t="inlineStr"/.test(attrs)) return decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
          return v != null ? decodeEntities(v).trim() : "";
        });
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        // Cells are separated like table cells in Word documents, so the columns stay readable.
        return cells.join(" | ");
      });
      out.push(`Sheet: ${names[i] ?? `Sheet ${m[1]}`}\n${rows.filter((r) => r.trim()).join("\n")}`);
    }
    return { kind: "xlsx", text: out.join("\n\n") };
  }
  return null;
}

// ---------- A small PDF text reader (fallback when no vision model is connected) ----------

async function inflateLoose(data: Uint8Array, format: "deflate" | "deflate-raw"): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > 8 * 1024 * 1024) break;
    }
  } catch {
    // Trailing bytes after the compressed data are common in PDFs: keep what was decoded.
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Text shown by a PDF content stream (Tj/TJ/'/" operators), with line breaks. Pure. */
export function pdfContentText(s: string): string {
  let out = "";
  let pending = "";
  let inArray = false;
  const nums: number[] = [];
  let i = 0;
  const readLiteral = (): string => {
    let depth = 1;
    let r = "";
    i++;
    while (i < s.length && depth > 0) {
      const c = s[i];
      if (c === "\\") {
        const n = s[i + 1];
        if (/[0-7]/.test(n)) {
          const oct = s.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)![0];
          r += String.fromCharCode(parseInt(oct, 8));
          i += 1 + oct.length;
          continue;
        }
        r += n === "n" ? "\n" : n === "r" ? "" : n === "t" ? "\t" : n === "b" || n === "f" ? "" : n === "\n" || n === "\r" ? "" : n;
        i += 2;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (depth > 0) r += c;
      i++;
    }
    return r;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "(") {
      pending += readLiteral();
      continue;
    }
    if (c === "<" && s[i + 1] !== "<") {
      const j = s.indexOf(">", i);
      if (j < 0) break;
      const hex = s.slice(i + 1, j).replace(/\s+/g, "");
      if (!/^[0-9a-f]*$/i.test(hex)) {
        i = j + 1;
        continue;
      }
      if (hex.length >= 4 && hex.slice(0, 4).toUpperCase() === "FEFF") {
        for (let k = 4; k + 3 < hex.length; k += 4) pending += String.fromCharCode(parseInt(hex.slice(k, k + 4), 16));
      } else if (!/0{2}[0-9a-f]{2}/i.test(hex.slice(0, 4))) {
        for (let k = 0; k + 1 < hex.length; k += 2) pending += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      }
      i = j + 1;
      continue;
    }
    if (c === "[") {
      inArray = true;
      i++;
      continue;
    }
    if (c === "]") {
      inArray = false;
      i++;
      continue;
    }
    if (c === "%") {
      while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
      continue;
    }
    const num = s.slice(i).match(/^[-+]?(?:\d+\.?\d*|\.\d+)/);
    if (num) {
      const v = Number(num[0]);
      // A big negative kerning value inside TJ is a word space.
      if (inArray && v < -180 && pending && !pending.endsWith(" ")) pending += " ";
      nums.push(v);
      if (nums.length > 6) nums.shift();
      i += num[0].length;
      continue;
    }
    const op = s.slice(i).match(/^(?:[A-Za-z]+\*?|'|")/);
    if (op) {
      const o = op[0];
      if (o === "Tj" || o === "TJ") out += pending;
      else if (o === "'" || o === '"') out += `\n${pending}`;
      else if (o === "T*") out += "\n";
      else if (o === "Td" || o === "TD") out += nums.length >= 2 && Math.abs(nums[nums.length - 1]) > 0.5 ? "\n" : pending ? "" : " ";
      else if (o === "ET") out += "\n";
      pending = o === "Tj" || o === "TJ" || o === "'" || o === '"' ? "" : pending;
      if (!["Tj", "TJ", "'", '"'].includes(o)) pending = "";
      i += o.length;
      continue;
    }
    i++;
  }
  return out;
}

/** Text from a PDF's content streams. Handles common text PDFs; scans and some font encodings need a vision model. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const latin = new TextDecoder("latin1").decode(bytes);
  const out: string[] = [];
  let total = 0;
  // Walk every "stream" keyword; its dictionary is the << … >> just before it.
  for (let pos = latin.indexOf("stream"); pos >= 0 && total < MAX_DOC_CHARS * 2; pos = latin.indexOf("stream", pos + 6)) {
    if (latin.slice(Math.max(0, pos - 3), pos) === "end") continue;
    let k = pos - 1;
    while (k > 0 && /\s/.test(latin[k])) k--;
    if (latin[k] !== ">" || latin[k - 1] !== ">") continue;
    let depth = 0;
    let d = k;
    for (; d > 0 && k - d < 8000; d--) {
      if (latin[d] === ">" && latin[d - 1] === ">") {
        depth++;
        d--;
      } else if (latin[d] === "<" && latin[d - 1] === "<") {
        depth--;
        d--;
        if (depth === 0) break;
      }
    }
    const dict = latin.slice(d, k + 1);
    let start = pos + 6;
    if (latin[start] === "\r") start++;
    if (latin[start] === "\n") start++;
    const end = latin.indexOf("endstream", start);
    if (end < 0) break;
    pos = end;
    if (/\/Subtype\s*\/(Image|XML|Form)|\/FontFile|\/Length[123]\b|\/Type\s*\/(ObjStm|XRef|Metadata|EmbeddedFile)/.test(dict)) continue;
    // The stream's data is /Length bytes when that's a plain number; otherwise drop the line break before endstream.
    const len = Number(dict.match(/\/Length\s+(\d+)(?!\d)(?!\s+\d+\s+R)/)?.[1] ?? NaN);
    let stop = Number.isFinite(len) && start + len <= end ? start + len : end;
    if (stop === end) while (stop > start && (bytes[stop - 1] === 0x0a || bytes[stop - 1] === 0x0d)) stop--;
    let data = bytes.subarray(start, stop);
    if (/\/FlateDecode/.test(dict)) data = await inflateLoose(data, "deflate");
    else if (/\/Filter/.test(dict)) continue;
    const text = pdfContentText(new TextDecoder("latin1").decode(data));
    if (text.trim()) {
      out.push(text);
      total += text.length;
    }
  }
  const text = out.join("\n");
  // Glyph-coded fonts come out as gibberish: if most of it isn't letters, it wasn't readable.
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters > 20 && letters / Math.max(1, text.replace(/\s/g, "").length) > 0.55 ? text : "";
}

const cleanName = (name: string) => name.replace(/[\u0000-\u001f<>"\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "document";

/**
 * Read an attached file into plain text. Office files and text are read here; PDFs and photos
 * go to the vision `reader` when there is one (scans, any layout), else PDFs use the built-in reader.
 */
export async function readDocument(file: RawFile, opts: { reader?: DocumentReader | null; signal?: AbortSignal } = {}): Promise<DocumentText> {
  const b = file.bytes;
  const name = cleanName(file.name);
  if (b.length === 0) throw new InputError("That file is empty.");
  if (b.length > MAX_DOC_BYTES) throw new InputError("That file is over 4 MB. Try a smaller version, or a photo of the page that matters.");
  const sniffed = sniffKind(b, name, file.type);
  let kind: DocKind;
  let text = "";
  if (sniffed === "zip") {
    let office: { kind: DocKind; text: string } | null = null;
    try {
      office = await officeText(b, listZip(b));
    } catch {
      office = null;
    }
    if (!office) throw new InputError("That archive isn't a Word, PowerPoint or Excel file I can read.");
    kind = office.kind;
    text = office.text;
  } else if (sniffed === "pdf") {
    kind = "pdf";
    // The built-in reader runs alongside the vision model and is used if the model can't help.
    const local = pdfText(b).catch(() => "");
    if (opts.reader) {
      try {
        text = await opts.reader.read(b, "application/pdf", name, opts.signal);
      } catch {
        text = "";
      }
    }
    if (!text.trim()) text = await local;
    if (!text.trim()) throw new InputError(opts.reader ? "I couldn't read that PDF. Try a photo of the page that matters." : "That PDF looks scanned or uses an unusual font. Try a Word file, a photo of the page, or paste the text.");
  } else if (sniffed === "image") {
    kind = "image";
    if (!opts.reader) throw new InputError("Reading photos needs the Claude API key to be set. Paste the text instead.");
    const mime = IMAGE_MIME[ext(name)] ?? (file.type && /^image\//.test(file.type) ? file.type : "image/jpeg");
    text = await opts.reader.read(b, mime, name, opts.signal);
  } else if (sniffed === "rtf") {
    kind = "rtf";
    text = rtfText(decodeText(b));
  } else if (sniffed === "html") {
    kind = "html";
    text = htmlText(decodeText(b));
  } else if (sniffed === "text") {
    kind = "text";
    text = decodeText(b);
  } else if (/^(doc|ppt|xls)$/.test(ext(name))) {
    throw new InputError(`That's an older Office file. Save it as .${ext(name)}x and attach it again, or attach a PDF.`);
  } else {
    throw new InputError("I can read PDF, Word, PowerPoint, Excel, text files and photos. That file type isn't one of them.");
  }
  text = cleanDocText(text);
  if (!text) throw new InputError("I couldn't find any text in that file.");
  const truncated = text.length > MAX_DOC_CHARS;
  return { name, kind, text: truncated ? text.slice(0, MAX_DOC_CHARS) : text, truncated };
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "what", "when", "where", "which", "about", "into", "your", "our", "are", "was", "will", "is", "of", "to", "in", "on", "at", "a", "an", "or"]);

const terms = (q: string) => [...new Set(foldText(q).split(" ").filter((w) => w.length > 1 && !STOP.has(w)))];

/** Strip anything that could pose as our own markup, and normalise whitespace. Pure. */
export function cleanDocText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/<\/?(?:document|request|source|system)[^>]*>/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The documents as they go into a prompt: each wrapped in <document> tags and cut to share
 * `maxChars` fairly. Says when something was cut so the agent knows to search the rest. Pure.
 */
export function documentsBlock(docs: DocumentText[], maxChars: number): { text: string; cut: boolean } {
  if (docs.length === 0) return { text: "", cut: false };
  const share = Math.max(400, Math.floor(maxChars / docs.length));
  let cut = false;
  const parts = docs.map((d) => {
    const body = cleanDocText(d.text);
    const over = body.length > share;
    if (over || d.truncated) cut = true;
    const name = d.name.replace(/["<>]/g, "").slice(0, 80);
    return `<document name="${name}"${d.kind ? ` kind="${d.kind}"` : ""}>\n${over ? `${body.slice(0, share)}\n[…cut here; ${body.length - share} more characters]` : body}\n</document>`;
  });
  return { text: parts.join("\n"), cut };
}

export type Passage = { doc: string; text: string; score: number };

/** The passages most relevant to a query, across all documents (overlapping ~700-character windows). Pure. */
export function searchDocuments(docs: DocumentText[], query: string, take = 3): Passage[] {
  const want = terms(query);
  if (want.length === 0) return [];
  const out: Passage[] = [];
  for (const d of docs) {
    const body = cleanDocText(d.text);
    for (let i = 0; i < body.length; i += 500) {
      const text = body.slice(i, i + 700);
      const hay = foldText(text);
      let score = 0;
      for (const w of want) {
        const hits = hay.split(w).length - 1;
        if (hits) score += 1 + Math.min(2, hits - 1) * 0.25;
      }
      if (score > 0) out.push({ doc: d.name, text, score: score / want.length });
      if (i + 700 >= body.length) break;
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, take);
}
