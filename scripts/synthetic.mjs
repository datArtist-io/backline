// Synthetic monitoring (the bug-finding book, section 8.4): checks the live site the way a person
// uses it, and exits non-zero on the first thing a person would notice. Run every 30 minutes by
// .github/workflows/synthetic.yml; with --plan it also plans a trip end to end (once every few hours,
// since a real run spends model and fare credits).
//   node scripts/synthetic.mjs [--base https://backline.travel] [--plan]
const args = process.argv.slice(2);
const base = (args[args.indexOf("--base") + 1] && args.includes("--base") ? args[args.indexOf("--base") + 1] : process.env.SITE_URL || "https://backline.travel").replace(/\/$/, "");
const plan = args.includes("--plan");
const ua = { "User-Agent": "BacklineSynthetic/1.0 (+https://backline.travel)", "x-backline-source": "synthetic" };

const results = [];
const check = async (name, fn) => {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? "" });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) });
  }
};
const get = (path) => fetch(`${base}${path}`, { headers: ua, redirect: "manual", signal: AbortSignal.timeout(20_000) });

await check("health", async () => {
  const r = await get("/api/health");
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const h = await r.json();
  const failing = (h.failing ?? []).filter((s) => !/^hotels|^flights/.test(s));
  if (!h.ok && failing.length) throw new Error(`failing: ${failing.join(", ")}`);
  const serp = (h.services ?? []).find((s) => /SerpApi/.test(s.service));
  const left = serp?.detail?.match(/(\d+) searches left/);
  if (left && Number(left[1]) < 20) throw new Error(`SerpApi nearly out: ${serp.detail}`);
  return `${(h.services ?? []).filter((s) => s.ok).length} services ok${serp?.detail ? `, ${serp.detail}` : ""}`;
});
for (const [name, path, mustHave] of [["landing", "/", "Backline"], ["trip view", "/adventure", "Lisbon"], ["mission holding", "/mission", "Give the agent a goal"], ["privacy", "/privacy", "Privacy notice"]]) {
  await check(name, async () => {
    const r = await get(path);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const html = await r.text();
    if (!html.includes(mustHave)) throw new Error(`"${mustHave}" missing from the page`);
    if (!html.includes('data-bl-theme')) throw new Error("theme script missing from <head>");
    return `${Math.round(html.length / 1024)} KB`;
  });
}
await check("old domain redirects", async () => {
  const r = await fetch("https://backline-beta-one.vercel.app/", { headers: ua, redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r) return "unreachable (fine once the project is deleted)";
  return r.status >= 300 && r.status < 400 ? `redirects to ${r.headers.get("location")}` : `status ${r.status}: no redirect to backline.travel yet`;
});

if (plan) {
  await check("plan a trip end to end", async () => {
    const r = await fetch(`${base}/api/mission`, { method: "POST", headers: { ...ua, "Content-Type": "application/json" }, body: JSON.stringify({ goal: "3 days in Lisbon for two, we love fado, March 10 to 13", autonomy: "auto", today: new Date().toISOString().slice(0, 10) }), signal: AbortSignal.timeout(150_000) });
    if (!r.ok || !r.body) throw new Error(`mission start: status ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", done = null, steps = {}, errors = [];
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (block.match(/^event:\s*(.*)$/m) ?? [])[1];
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        let d = {}; try { d = JSON.parse(data); } catch {}
        if (ev === "step.succeeded" || ev === "step.failed" || ev === "step.skipped") steps[d.skill] = ev.split(".")[1];
        if (ev === "mission.error") errors.push(d.error);
        if (ev === "mission.completed") done = d;
      }
      if (done) break;
    }
    if (errors.length) throw new Error(errors.join("; "));
    if (!done) throw new Error("the stream ended without mission.completed");
    const failed = Object.entries(steps).filter(([, s]) => s === "failed").map(([k]) => k);
    if (done.status === "failed" || failed.includes("trip.agent")) throw new Error(`status ${done.status}, failed: ${failed.join(", ") || "none"}`);
    return `status ${done.status} in ${Math.round(done.ms / 1000)} s, ${Object.values(steps).filter((s) => s === "succeeded").length} steps ok${failed.length ? `, failed: ${failed.join(", ")}` : ""}`;
  });
}

for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(26)} ${String(r.ms).padStart(6)} ms  ${r.detail}`);
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} check(s) failed on ${base}` : `\nAll ${results.length} checks passed on ${base}`);
process.exit(bad.length ? 1 : 0);
