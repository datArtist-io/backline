// A minimal, dependency-free ZIP reader: enough to open Word, PowerPoint and Excel files (which
// are ZIP archives of XML). Uses the platform's DecompressionStream, so it runs in Node, edge
// runtimes and browsers. Guards against oversized entries ("zip bombs").

export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; offset: number };

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** Whether the bytes look like a ZIP archive. Pure. */
export const isZip = (b: Uint8Array) => b.length > 22 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** The archive's table of contents (from the central directory). Throws on anything malformed. Pure. */
export function listZip(b: Uint8Array): ZipEntry[] {
  // The end-of-central-directory record sits in the last 22 bytes, plus up to 64 KB of comment.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count && n < 5000; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error("Damaged ZIP directory");
    const method = u16(b, p + 10);
    const compressedSize = u32(b, p + 20);
    const size = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen));
    if (local + 30 > b.length || u32(b, local) !== 0x04034b50) throw new Error("Damaged ZIP entry");
    const offset = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("ZIP entry is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** One entry's contents (stored or deflated), refusing anything that would unpack past `maxBytes`. */
export async function readZipEntry(b: Uint8Array, e: ZipEntry, maxBytes = 20 * 1024 * 1024): Promise<Uint8Array> {
  if (e.size > maxBytes) throw new Error("ZIP entry is too large");
  const data = b.subarray(e.offset, e.offset + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRaw(data, maxBytes);
  throw new Error(`Unsupported ZIP compression (${e.method})`);
}

/** Read one named entry as UTF-8 text, or null if it isn't there. */
export async function zipText(b: Uint8Array, entries: ZipEntry[], name: string, maxBytes?: number): Promise<string | null> {
  const e = entries.find((x) => x.name === name);
  return e ? new TextDecoder().decode(await readZipEntry(b, e, maxBytes)) : null;
}
