// Exporting a trip: a styled document (opens in Word, prints to PDF), a presentation (PowerPoint
// .pptx, built here with no extra packages) and a web slide deck. Everything is built in the
// browser from the mission's results; nothing is sent anywhere.
import type { Place, TasteOutput, TripAgentOutput, TripPlanOutput, TripRoutesOutput } from "@backline/engine";

export type ExportTrip = {
  title: string;
  chips: string[];
  agent: TripAgentOutput;
  plan: TripPlanOutput;
  routes?: TripRoutesOutput | null;
  places: Map<string, Place>;
  /** The taste profile from Qloo the plan was tuned to. */
  taste?: TasteOutput | null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString("en")} ${currency}`;
  }
};
const longDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "");
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`);

/** The trip as plain sections, shared by every format. */
export function outline(t: ExportTrip) {
  const { agent: a, plan: p, routes } = t;
  const hotels = (a.tiers ?? []).map((tier) => ({
    label: tier.label,
    picks: tier.picks.slice(0, 3).flatMap((pk) => {
      const pl = t.places.get(pk.id);
      if (!pl) return [];
      const price = pk.price ? `${money(pk.price.perNight, pk.price.currency)} a night${pk.price.site ? ` (${pk.price.site})` : ""}` : "price not listed";
      return [{ name: pl.name, line: [pl.rating != null ? `★ ${pl.rating.toFixed(1)}` : null, pl.distanceKm != null ? `${pl.distanceKm} km away` : null, price, pl.phone].filter(Boolean).join(" · ") }];
    }),
  }));
  const days = p.days.map((d, i) => {
    const r = routes?.days.find((x) => x.index === i);
    return {
      heading: `Day ${i + 1}: ${d.label}`,
      date: longDate(d.date),
      items: d.items.map((it) => {
        const pl = it.placeId ? t.places.get(it.placeId) : undefined;
        return { time: it.time, title: it.title, note: [it.note, pl?.address].filter(Boolean).join(" · ") };
      }),
      travel: r && r.minutes > 0 ? `About ${mins(r.minutes)} of travel, ${r.km} km${r.rides ? `; rides about ${money(r.rides.low, r.rides.currency)}–${money(r.rides.high, r.rides.currency)}` : ""}.` : "",
      directions: r?.directions ?? null,
    };
  });
  const budget = p.budget.map((b) => ({ item: b.item, amount: b.amount != null ? money(b.amount, b.currency) : "To confirm", basis: b.basis }));
  const sources = [...new Map(a.stays.flatMap((s) => s.sources).map((s) => [s.url, s])).values()].slice(0, 12);
  const tp = t.taste;
  const taste =
    tp && tp.signals.length + tp.tags.length > 0
      ? [
          `Read from: ${[...tp.signals.map((s) => s.name), ...tp.tags.map((x) => x.name)].join(", ")}`,
          tp.vibes.length ? `The vibe: ${tp.vibes.join(", ")}` : "",
          tp.scenes.length ? `Where this taste goes: ${tp.scenes.join(", ")}` : "",
          tp.dishes.length ? `What it orders: ${tp.dishes.join(", ")}` : "",
          tp.audience ? `Shared most by people ${tp.audience}` : "",
          tp.zone?.name ? `Strongest around ${tp.zone.name}` : "",
          tp.alsoLoved.length ? `Fans also love: ${tp.alsoLoved.map((x) => x.name).join(", ")}` : "",
        ].filter(Boolean)
      : [];
  return { summary: p.summary || a.summary, taste, hotels, days, budget, tips: p.tips, sources };
}

// ---------- Document (Word / PDF) ----------

export function tripDocumentHtml(t: ExportTrip): string {
  const o = outline(t);
  const css = `
    body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#10132b;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.5}
    h1{font-size:30px;margin:0 0 6px;letter-spacing:-.01em} h2{font-size:19px;margin:30px 0 10px;padding-bottom:6px;border-bottom:2px solid #8b5cf6}
    h3{font-size:15px;margin:18px 0 6px} .chips span{display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:99px;background:#efeaff;color:#4b2fb8;font-size:12px}
    .lead{font-size:16px;color:#33374f} table{width:100%;border-collapse:collapse;font-size:13.5px} td,th{padding:6px 8px;border-bottom:1px solid #e6e6ef;text-align:left;vertical-align:top}
    .time{width:64px;font-weight:700;color:#8b5cf6} .muted{color:#7a7f99;font-size:12.5px} .lane{font-weight:700;color:#8b5cf6;margin-top:12px}
    @media print{body{margin:0} h2{break-after:avoid} .day{break-inside:avoid}}`;
  const hotels = o.hotels.map((h) => `<p class="lane">${esc(h.label)}</p><ul>${h.picks.map((p) => `<li><b>${esc(p.name)}</b><br><span class="muted">${esc(p.line)}</span></li>`).join("")}</ul>`).join("");
  const days = o.days
    .map(
      (d) =>
        `<div class="day"><h3>${esc(d.heading)}${d.date ? ` <span class="muted">· ${esc(d.date)}</span>` : ""}</h3><table>${d.items
          .map((it) => `<tr><td class="time">${esc(it.time)}</td><td><b>${esc(it.title)}</b>${it.note ? `<br><span class="muted">${esc(it.note)}</span>` : ""}</td></tr>`)
          .join("")}</table>${d.travel ? `<p class="muted">${esc(d.travel)}${d.directions ? ` <a href="${esc(d.directions)}">Directions</a>` : ""}</p>` : ""}</div>`
    )
    .join("");
  const budget = o.budget.length ? `<h2>Budget</h2><table>${o.budget.map((b) => `<tr><th>${esc(b.item)}</th><td>${esc(b.amount)}</td><td class="muted">${esc(b.basis)}</td></tr>`).join("")}</table>` : "";
  const tips = o.tips.length ? `<h2>Good to know</h2><ul>${o.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const sources = o.sources.length ? `<h2>Sources</h2><ul class="muted">${o.sources.map((s) => `<li><a href="${esc(s.url)}">${esc(s.title)}</a></li>`).join("")}</ul>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)}</title><style>${css}</style></head><body>
<h1>${esc(t.title)}</h1><p class="chips">${t.chips.map((c) => `<span>${esc(c)}</span>`).join("")}</p>
<p class="lead">${esc(o.summary)}</p>
${o.taste.length ? `<h2>Your taste, read by Qloo</h2><ul>${o.taste.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
${hotels ? `<h2>Where to stay</h2>${hotels}` : ""}
<h2>The plan</h2>${days}${budget}${tips}${sources}
<p class="muted" style="margin-top:30px">Prices as listed online when planned; confirm when you book. Taste data by Qloo.</p></body></html>`;
}

/** Opens the document in a new tab and brings up the print dialog (choose "Save as PDF"). */
export function printDocument(t: ExportTrip) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(tripDocumentHtml(t));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}

// ---------- Web slides ----------

type Slide = { kicker: string; title: string; lines: string[] };

export function slidesOf(t: ExportTrip): Slide[] {
  const o = outline(t);
  const slides: Slide[] = [{ kicker: "Trip plan", title: t.title, lines: [o.summary, t.chips.join("  ·  ")] }];
  if (o.taste.length) slides.push({ kicker: "Taste by Qloo", title: "Tuned to your taste", lines: o.taste });
  for (const h of o.hotels) slides.push({ kicker: "Where to stay", title: h.label, lines: h.picks.map((p) => `${p.name} — ${p.line}`) });
  for (const d of o.days) slides.push({ kicker: d.date || "The plan", title: d.heading, lines: [...d.items.map((it) => `${it.time}  ${it.title}`), ...(d.travel ? [d.travel] : [])] });
  if (o.budget.length) slides.push({ kicker: "Money", title: "Budget", lines: o.budget.map((b) => `${b.item}: ${b.amount}`) });
  if (o.tips.length) slides.push({ kicker: "Before you go", title: "Good to know", lines: o.tips });
  return slides;
}

const SLIDE_COLORS = ["#8b5cf6", "#f97316", "#10b981", "#3b82f6", "#ec4899", "#0ea5e9"];

export function slidesHtml(t: ExportTrip): string {
  const slides = slidesOf(t);
  const body = slides
    .map(
      (s, i) =>
        `<section style="--c:${SLIDE_COLORS[i % SLIDE_COLORS.length]}"><p class="k">${esc(s.kicker)}</p><h1>${esc(s.title)}</h1><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="n">${i + 1} / ${slides.length}</p></section>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t.title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#0d0f24;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;overflow:hidden}
section{position:absolute;inset:0;padding:8vh 8vw;display:flex;flex-direction:column;justify-content:center;color:#fff;opacity:0;transform:translateX(4vw);transition:opacity .6s cubic-bezier(.22,1,.36,1),transform .6s cubic-bezier(.22,1,.36,1);
background:radial-gradient(120vh 90vh at 85% 15%,color-mix(in srgb,var(--c) 55%,transparent),transparent 60%),radial-gradient(90vh 70vh at 5% 95%,color-mix(in srgb,var(--c) 30%,transparent),transparent 60%),#0d0f24}
section.on{opacity:1;transform:none}.k{text-transform:uppercase;letter-spacing:.14em;font-weight:700;font-size:1.6vh;color:color-mix(in srgb,var(--c) 70%,#fff)}
h1{font-size:6.2vh;line-height:1.08;margin:.4em 0 .6em;max-width:22ch}ul{list-style:none;padding:0;margin:0;font-size:2.6vh;line-height:1.5;max-width:70ch}li{padding:.35em 0;border-bottom:1px solid rgba(255,255,255,.12)}
.n{position:absolute;right:4vw;bottom:4vh;font-size:1.6vh;opacity:.6}.hint{position:fixed;left:4vw;bottom:4vh;color:#fff;opacity:.45;font-size:1.5vh}
@media print{section{position:relative;opacity:1;transform:none;height:100vh;page-break-after:always}.hint{display:none}html,body{overflow:visible}}
</style></head><body>${body}<p class="hint">← → or tap to move</p><script>
const s=[...document.querySelectorAll('section')];let i=0;const go=n=>{i=Math.max(0,Math.min(s.length-1,n));s.forEach((x,k)=>x.classList.toggle('on',k===i))};go(0);
addEventListener('keydown',e=>{if(['ArrowRight',' ','PageDown'].includes(e.key))go(i+1);if(['ArrowLeft','PageUp'].includes(e.key))go(i-1)});
addEventListener('click',e=>go(e.clientX>innerWidth/3?i+1:i-1));
</script></body></html>`;
}

// ---------- PowerPoint (.pptx) ----------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A ZIP archive with stored (uncompressed) entries. Pure. */
export function zipStore(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const dir: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text);
    const nm = enc.encode(name);
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true);
    c.setUint32(42, offset, true);
    dir.push(new Uint8Array(c.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const size = dir.reduce((n, d) => n + d.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const all = [...parts, ...dir, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of all) {
    out.set(x, at);
    at += x.length;
  }
  return out;
}

const xesc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const W = 12192000;
const H = 6858000;

const textBox = (id: number, name: string, x: number, y: number, w: number, h: number, paras: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
const run = (text: string, size: number, color: string, bold = false) => `<a:r><a:rPr lang="en-GB" sz="${size}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xesc(text)}</a:t></a:r>`;

function slideXml(s: Slide, color: string, n: number, total: number): string {
  const bg = `<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="0D0F24"/></a:gs><a:gs pos="100000"><a:srgbClr val="${color}"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`;
  const lines = s.lines.slice(0, 12).map((l) => `<a:p><a:pPr><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr>${run(l, s.lines.length > 8 ? 1500 : 1800, "FFFFFF")}</a:p>`).join("") || "<a:p><a:endParaRPr lang=\"en-GB\"/></a:p>";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${textBox(2, "Kicker", 685800, 457200, W - 1371600, 457200, `<a:p>${run(s.kicker.toUpperCase(), 1300, "D9CCFF", true)}</a:p>`)}${textBox(3, "Title", 685800, 914400, W - 1371600, 1143000, `<a:p>${run(s.title, 3600, "FFFFFF", true)}</a:p>`)}${textBox(4, "Body", 685800, 2209800, W - 1371600, H - 2971800, lines)}${textBox(5, "Number", W - 2286000, H - 685800, 1600200, 365760, `<a:p><a:pPr algn="r"/>${run(`${n} / ${total}`, 1100, "BBBBCC")}</a:p>`)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Trip"><a:themeElements><a:clrScheme name="Trip"><a:dk1><a:srgbClr val="10132B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2340"/></a:dk2><a:lt2><a:srgbClr val="EEF1F8"/></a:lt2><a:accent1><a:srgbClr val="8B5CF6"/></a:accent1><a:accent2><a:srgbClr val="F97316"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="3B82F6"/></a:accent4><a:accent5><a:srgbClr val="EC4899"/></a:accent5><a:accent6><a:srgbClr val="0EA5E9"/></a:accent6><a:hlink><a:srgbClr val="3B82F6"/></a:hlink><a:folHlink><a:srgbClr val="8B5CF6"/></a:folHlink></a:clrScheme><a:fontScheme name="Trip"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Trip"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/** A PowerPoint file of the trip: a title slide, the hotel lanes, one slide per day, budget and tips. */
export function buildPptx(t: ExportTrip): Blob {
  const slides = slidesOf(t);
  const hex = SLIDE_COLORS.map((c) => c.slice(1).toUpperCase());
  const files: [string, string][] = [];
  const ct = slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  files.push([
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${ct}</Types>`,
  ]);
  files.push([
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  ]);
  files.push(["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xesc(t.title)}</dc:title></cp:coreProperties>`]);
  files.push(["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Slides>${slides.length}</Slides></Properties>`]);
  files.push([
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  ]);
  files.push([
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`,
  ]);
  const emptyTree = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>`;
  files.push([
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}>${emptyTree}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  ]);
  files.push([
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`,
  ]);
  files.push(["ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1">${emptyTree}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`]);
  files.push([
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
  ]);
  files.push(["ppt/theme/theme1.xml", THEME]);
  slides.forEach((s, i) => {
    files.push([`ppt/slides/slide${i + 1}.xml`, slideXml(s, hex[i % hex.length], i + 1, slides.length)]);
    files.push([
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    ]);
  });
  return new Blob([zipStore(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

/** Save a blob as a file. */
export function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
