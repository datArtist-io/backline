// The calling line's configuration as Vapi has it (provider, transport, number), for diagnosing calls.
// Signed-in only, and anything that looks like a secret is removed before it leaves the server.
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET = /key|secret|token|password|credential|auth|sip.*user/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => scrub(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, scrub(x, depth + 1)]));
  return v;
}

export async function GET() {
  if (!(await getSession().catch(() => null))) return Response.json({ error: "Sign in first." }, { status: 401 });
  const key = process.env.VAPI_API_KEY;
  const id = process.env.VAPI_PHONE_NUMBER_ID;
  if (!key || !id) return Response.json({ error: "Calling isn't connected." }, { status: 503 });
  const res = await fetch(`https://api.vapi.ai/phone-number/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res) return Response.json({ error: "Vapi didn't answer." }, { status: 502 });
  const body = await res.json().catch(() => null);
  return Response.json({ ok: res.ok, status: res.status, line: scrub(body), demoLine: Boolean(process.env.CALL_DEMO_TO), live: process.env.CALLS_LIVE === "1" }, { headers: { "Cache-Control": "no-store" } });
}
