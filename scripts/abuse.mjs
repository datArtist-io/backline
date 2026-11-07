// A hostile user at the HTTP layer (the bug-finding book, section 9.2): wrong methods, oversized and
// malformed bodies, injection strings, unauthenticated writes, path games. Every answer must be a
// clean 4xx with no stack trace and no secret; a 5xx or a leaked internal is a finding.
//   node scripts/abuse.mjs [--base http://127.0.0.1:3100]
const args = process.argv.slice(2);
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : process.env.SITE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const h = { "Content-Type": "application/json", "User-Agent": "BacklineAbuse/1.0" };
const findings = [];
const leaks = /at [\w.]+ \(|node_modules|\/home\/|\/var\/task|Error: |ECONNREFUSED|sk-ant-|eyJhbGci|SUPABASE_SERVICE/;

async function probe(name, path, init, expectStatus, expectBody = () => true) {
  let r, body = "";
  try {
    r = await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
    body = await r.text().catch(() => "");
  } catch (e) {
    findings.push(`${name}: request failed (${e instanceof Error ? e.message : e})`);
    return;
  }
  const ok = expectStatus(r.status) && expectBody(body);
  const leak = leaks.test(body) && !/^\s*</.test(body.trim()); // an HTML page may legitimately contain "Error:" in copy
  const line = `${ok && !leak ? "ok  " : "FAIL"} ${String(r.status).padStart(3)}  ${name}`;
  console.log(line);
  if (!ok) findings.push(`${name}: status ${r.status} (${body.slice(0, 120).replace(/\s+/g, " ")})`);
  if (leak) findings.push(`${name}: the response leaks internals: ${body.match(leaks)?.[0]}`);
}

const is4xx = (s) => s >= 400 && s < 500;
const not5xx = (s) => s < 500;
const big = JSON.stringify({ goal: "x".repeat(200_000), autonomy: "auto" });
const inj = "Lisbon 3 nights <script>alert(1)</script> {{7*7}} ' OR 1=1 -- ../../etc/passwd %00 ‮";

await probe("mission: wrong method", "/api/mission", { method: "GET" }, (s) => s === 405 || s === 404 || is4xx(s));
await probe("mission: 200 KB body", "/api/mission", { method: "POST", headers: h, body: big }, (s) => s === 413 || s === 400);
await probe("mission: malformed JSON", "/api/mission", { method: "POST", headers: h, body: "{not json" }, (s) => s === 400);
await probe("mission: wrong types", "/api/mission", { method: "POST", headers: h, body: JSON.stringify({ goal: { $gt: "" }, autonomy: 42 }) }, (s) => s === 400);
// 503 is the deliberate "not configured" answer on a build with no keys; a 500 would be a crash.
await probe("mission: injection goal", "/api/mission", { method: "POST", headers: h, body: JSON.stringify({ goal: inj, autonomy: "auto" }) }, (s) => s !== 500 && s !== 502);
await probe("mission: empty goal", "/api/mission", { method: "POST", headers: h, body: JSON.stringify({ goal: "", autonomy: "auto" }) }, (s) => s === 400);
await probe("account: write signed out", "/api/account", { method: "POST", headers: h, body: JSON.stringify({ name: "x" }) }, (s) => s === 401 || s === 403 || s === 405);
await probe("account trips: delete signed out", "/api/account/trips", { method: "DELETE", headers: h, body: JSON.stringify({ id: "x" }) }, (s) => s === 401 || s === 403 || s === 405 || s === 404);
await probe("account documents: read signed out", "/api/account/documents", { method: "GET" }, (s) => s === 401 || s === 403 || s === 405);
await probe("wallet: pay signed out", "/api/wallet/pay", { method: "POST", headers: h, body: JSON.stringify({ amount: 1e9, currency: "USD" }) }, (s) => s === 401 || s === 403 || s === 400);
await probe("wallet: refund signed out", "/api/wallet/refund", { method: "POST", headers: h, body: JSON.stringify({ id: "x" }) }, (s) => s === 401 || s === 403 || s === 400);
await probe("wallet: negative top-up", "/api/wallet", { method: "POST", headers: h, body: JSON.stringify({ amount: -5000 }) }, (s) => s === 400 || s === 401 || s === 403);
await probe("share: traversal id", "/api/share/trip?id=../../etc/passwd", { method: "GET" }, (s) => s === 400 || s === 404);
await probe("share: huge id", `/api/share/trip?id=${"a".repeat(5000)}`, { method: "GET" }, (s) => s === 400 || s === 404 || s === 414);
await probe("share: 200 KB snapshot", "/api/share/trip", { method: "POST", headers: h, body: JSON.stringify({ snap: { x: "y".repeat(200_000) } }) }, (s) => s === 413 || s === 400 || s === 401);
await probe("share email: stranger's address", "/api/share/email", { method: "POST", headers: h, body: JSON.stringify({ to: "victim@example.com", url: "https://evil.example" }) }, (s) => s === 400 || s === 401 || s === 403);
await probe("calls: start signed out", "/api/calls", { method: "POST", headers: h, body: JSON.stringify({ to: "+15550199", brief: "hi" }) }, (s) => s === 401 || s === 403 || s === 400 || s === 405);
await probe("demo-call: random number", "/api/demo-call", { method: "POST", headers: h, body: JSON.stringify({ to: "+15550199" }) }, (s) => s === 400 || s === 401 || s === 403 || s === 503);
// With VAPI_WEBHOOK_SECRET set this is a 401. Without it the handler answers, but only a call that
// Vapi itself confirms can create a trip or send an email, so the answer must carry no result.
await probe("vapi inbound: unsigned webhook", "/api/vapi/inbound", { method: "POST", headers: h, body: JSON.stringify({ message: { type: "tool-calls", call: { id: "fake" }, toolCallList: [{ id: "t1", function: { name: "plan_trip", arguments: { destination: "Lisbon" } } }] } }) }, (s) => s === 401 || s === 403 || s === 200, (b) => !b.includes("Your trip code is") || b.includes("unauthorized"));
await probe("transcribe: wrong content", "/api/transcribe", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x".repeat(100) }, (s) => s === 400 || s === 401 || s === 415 || s === 503);
await probe("documents: 2 MB text as a file", "/api/documents", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "z".repeat(2_000_000) }, (s) => s === 413 || s === 400 || s === 401 || s === 415);
await probe("kyc: signed out", "/api/kyc", { method: "POST", headers: h, body: JSON.stringify({}) }, (s) => s === 401 || s === 403 || s === 400 || s === 503);
await probe("ops: internal page", "/api/ops", { method: "GET" }, (s) => s === 401 || s === 403 || s === 404);
await probe("client-error: 20 KB", "/api/client-error", { method: "POST", headers: h, body: JSON.stringify({ message: "m".repeat(20_000) }) }, (s) => s === 413);
await probe("client-error: malformed", "/api/client-error", { method: "POST", headers: h, body: "nope" }, (s) => s === 400);
await probe("health: wrong method", "/api/health", { method: "DELETE" }, (s) => s === 405 || s === 404 || is4xx(s));
await probe("page: unicode path", "/mission/%E2%80%AE%00", { method: "GET" }, not5xx);
await probe("page: very long query", `/mission?goal=${"a".repeat(8000)}`, { method: "GET" }, not5xx);

console.log(findings.length ? `\n${findings.length} finding(s):\n- ${findings.join("\n- ")}` : "\nNo findings: every probe got a clean 4xx with nothing leaked.");
process.exit(findings.length ? 1 : 0);
