// Dependency audit gate: fails on a high or critical advisory that reaches production code. Dev-only
// tooling (test runners, bundler internals) is reported but does not block, because it never ships.
// Each accepted finding is listed with its reason and a date, and is re-checked on every run.
import { execSync } from "node:child_process";

const ACCEPTED = {
  // The sanitiser bypass is in MapLibre's popup/attribution HTML path; Backline never uses Popup and
  // escapes every string it puts in a marker itself. Upgrade to 6.x planned with the next globe work.
  "maplibre-gl": { until: "2026-12-31", why: "no Popup use; marker HTML escaped by us" },
  // zod 4 is a 224-error migration. The risk (memory on oversized constrained arrays) is closed on
  // our side by the 64 KB cap on every JSON body (lib/body.ts) and Vercel's 4.5 MB request limit.
  zod: { until: "2026-12-31", why: "request bodies capped at 64 KB" },
};
const DEV_ONLY = new Set(["vitest", "vite", "tinypool", "@vitest/mocker", "esbuild", "postcss", "launch-editor"]);

let out;
try {
  out = execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (e) {
  out = e.stdout?.toString() ?? "";
}
const report = JSON.parse(out || "{}");
const today = new Date().toISOString().slice(0, 10);
let block = 0;
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  if (!["high", "critical"].includes(v.severity)) continue;
  const titles = v.via.filter((x) => typeof x === "object").map((x) => x.title).slice(0, 2).join("; ") || v.via.join(", ");
  const acc = ACCEPTED[name];
  if (acc && acc.until >= today) console.log(`accepted  ${v.severity.padEnd(8)} ${name}: ${acc.why} (until ${acc.until})`);
  else if (DEV_ONLY.has(name)) console.log(`dev-only  ${v.severity.padEnd(8)} ${name}: ${titles}`);
  else {
    console.log(`BLOCK     ${v.severity.padEnd(8)} ${name}: ${titles}${acc ? " (acceptance expired)" : ""}`);
    block++;
  }
}
console.log(block ? `\n${block} finding(s) need a fix or a dated acceptance in scripts/audit.mjs` : "\nNo blocking advisories.");
process.exit(block ? 1 : 0);
