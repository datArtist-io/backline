import { createRequire } from "module";
import fs from "fs";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const F = new URL("./node_modules/@fontsource", import.meta.url).pathname;
const b64 = (p) => fs.readFileSync(p).toString("base64");
const css = `
@font-face{font-family:'BLD';src:url(data:font/woff2;base64,${b64(F+"/unbounded/files/unbounded-latin-400-normal.woff2")}) format('woff2');font-weight:400}
@font-face{font-family:'BLD';src:url(data:font/woff2;base64,${b64(F+"/unbounded/files/unbounded-latin-500-normal.woff2")}) format('woff2');font-weight:500}
@font-face{font-family:'BLD';src:url(data:font/woff2;base64,${b64(F+"/unbounded/files/unbounded-latin-300-normal.woff2")}) format('woff2');font-weight:300}
@font-face{font-family:'BLB';src:url(data:font/woff2;base64,${b64(F+"/hanken-grotesk/files/hanken-grotesk-latin-400-normal.woff2")}) format('woff2');font-weight:400}
@font-face{font-family:'BLB';src:url(data:font/woff2;base64,${b64(F+"/hanken-grotesk/files/hanken-grotesk-latin-500-normal.woff2")}) format('woff2');font-weight:500}
@font-face{font-family:'BLB';src:url(data:font/woff2;base64,${b64(F+"/hanken-grotesk/files/hanken-grotesk-latin-600-normal.woff2")}) format('woff2');font-weight:600}
@font-face{font-family:'BLB';src:url(data:font/woff2;base64,${b64(F+"/hanken-grotesk/files/hanken-grotesk-latin-700-normal.woff2")}) format('woff2');font-weight:700}
:root,html,body{--font-display:'BLD' !important;--font-body:'BLB' !important}
html,body{font-family:'BLB',sans-serif !important}

`;
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.route("**/api/call-trips**", (r) => r.fulfill({ json: { number: "+16182601647", trips: [
  { code: "4417", at: new Date(Date.now() - 120000).toISOString(), live: false, destination: "Lisbon", days: 4, travellers: 2, loves: "fado and seafood", url: "/mission?goal=a" },
  { code: "0362", at: new Date(Date.now() - 900e3).toISOString(), live: false, destination: "Tokyo", days: 5, travellers: 1, loves: "city pop and ramen", url: "/mission?goal=t" } ] } }));
await p.route("**/api/auth/session**", (r) => r.fulfill({ json: { user: null } }));
await p.goto(process.env.SITE || "http://localhost:3124/", { waitUntil: "networkidle" });
await p.addStyleTag({ content: css });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(6000);
// scroll through once
const H = await p.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < H; y += 600) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(150); }
await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(1500);
await p.screenshot({ path: "capture/page.png", fullPage: true });
await p.addStyleTag({ content: ".try-chip,.voice-card,.caps-panel,.prompt,.switch,.recent-label{visibility:hidden !important}" });
await p.waitForTimeout(300);
await p.screenshot({ path: "capture/base.png", fullPage: true });
const boxes = await p.evaluate(() => {
  const pick = (sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { sel, x: r.x, y: r.y + scrollY, w: r.width, h: r.height }; });
  return { H: document.documentElement.scrollHeight, items: [...pick(".prompt"), ...pick(".switch"), ...pick(".try-chip"), ...pick(".voice-card"), ...pick(".caps-title"), ...pick(".caps-panel"), ...pick(".hero-title"), ...pick(".nav"), ...pick("footer")] };
});
fs.writeFileSync("capture/boxes.json", JSON.stringify(boxes, null, 1));
console.log(H, boxes.items.map((i) => i.sel + ":" + Math.round(i.y) + "/" + Math.round(i.h)).join(" "));
await b.close();
