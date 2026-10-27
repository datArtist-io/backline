import { createRequire } from "module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const b = await chromium.launch();
const mk = async () => { const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); await p.goto("http://localhost:8800/film.html"); await p.evaluate(() => window.init()); return p; };
const seqP = await mk();
const checks = [3, 6, 9.8, 12, 15, 20, 24, 29, 31.2, 33.5, 35, 36.8, 37.6, 39, 41.5];
let t = 0;
for (const c of checks) {
  for (; t < c; t += 0.1) await seqP.evaluate((x) => window.seek(x), t);
  await seqP.evaluate((x) => window.seek(x), c);
  const a = await seqP.screenshot();
  const d = await mk(); await d.evaluate((x) => window.seek(x), c); const bb = await d.screenshot(); await d.close();
  const fs = await import("fs"); fs.writeFileSync(`pv/pa_${c}.png`, a); fs.writeFileSync(`pv/pb_${c}.png`, bb);
}
await b.close();
