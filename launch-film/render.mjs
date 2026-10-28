// Render the film: node render.mjs out.mp4 fps [subframes] [t0] [t1]
import { createRequire } from "module";
import { spawn } from "child_process";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright");
const [out = "preview.mp4", fpsS = "30", subS = "1", t0S, t1S] = process.argv.slice(2);
const fps = Number(fpsS), sub = Number(subS);
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("http://localhost:8800/film.html");
await p.evaluate(() => window.init());
const dur = await p.evaluate(() => window.DURATION);
const t0 = t0S ? Number(t0S) : 0, t1 = t1S ? Number(t1S) : dur;
const n = Math.round((t1 - t0) * fps);
const args = ["-y", "-f", "image2pipe", "-framerate", String(fps * sub), "-c:v", "mjpeg", "-i", "-"];
if (sub > 1) args.push("-vf", `tmix=frames=${sub}:weights='${Array(sub).fill(1).join(" ")}',select='not(mod(n\\,${sub}))',setpts=N/${fps}/TB`);
args.push("-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", out);
const ff = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "inherit"] });
const started = Date.now();
for (let i = 0; i < n; i++) {
  for (let s = 0; s < sub; s++) {
    const t = t0 + (i + (s / sub) * 0.7) / fps;
    await p.evaluate((t) => window.seek(t), t);
    const buf = await p.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  if (i % 60 === 0) console.error(`frame ${i}/${n} ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await b.close();
console.error("done", out);
