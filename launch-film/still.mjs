import { createRequire } from "module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const times = process.argv.slice(2).map(Number);
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto("http://localhost:8800/film.html");
await p.evaluate(() => window.init());
for (const t of times) {
  await p.evaluate((t) => window.seek(t), t);
  await p.waitForTimeout(60);
  await p.screenshot({ path: `stills/s_${t.toFixed(2)}.png` });
}
console.log("errors:", errs.slice(0, 5));
await b.close();
