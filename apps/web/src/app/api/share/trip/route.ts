// Shared trip links. POST saves a finished trip exactly as it was planned and returns a link; GET reads
// it back, so everyone who opens the link sees the same trip without a new planning run.
import { randomBytes } from "node:crypto";
import { supabaseConfig } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tooMany = rateLimiter(12, 10 * 60_000);
const tooManyReads = rateLimiter(120, 60_000);
const ID = /^[A-Za-z0-9]{10,24}$/;
const MAX_BYTES = 2_900_000;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

const newId = () => Array.from(randomBytes(12), (b) => ALPHA[b % ALPHA.length]).join("");

async function rpc<T>(fn: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
  const cfg = supabaseConfig();
  if (!cfg) return { ok: false, status: 503, data: null, text: "not configured" };
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token ?? cfg.anonKey}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text: text.slice(0, 200) };
}

/** Drops what must never travel with a shared trip: the approval seal and anything about the planner. */
function clean(snap: Record<string, unknown>): Record<string, unknown> {
  const { seal: _seal, ...rest } = snap;
  void _seal;
  return { ...rest, seal: null };
}

export async function POST(req: Request) {
  if (tooMany(clientIp(req))) return Response.json({ ok: false, reason: "Too many links in a short time. Try again in a few minutes." }, { status: 429 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ ok: false, reason: "This trip is too large to share as a link." }, { status: 413 });
  let body: { goal?: unknown; snap?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, reason: "That request wasn't readable." }, { status: 400 });
  }
  const goal = typeof body.goal === "string" ? body.goal.trim().slice(0, 2000) : "";
  const snap = body.snap && typeof body.snap === "object" && !Array.isArray(body.snap) ? (body.snap as Record<string, unknown>) : null;
  if (!goal || !snap || !snap.planned || (snap.status !== "done" && snap.status !== "waiting")) {
    return Response.json({ ok: false, reason: "Only a finished trip can be shared." }, { status: 400 });
  }
  const session = await getSession().catch(() => null);
  const id = newId();
  const r = await rpc<string>("share_trip_save", { p_id: id, p_goal: goal, p_snap: clean(snap) }, session?.accessToken);
  if (!r.ok) {
    console.error("[share] save failed", r.status, r.text);
    const missing = r.status === 404 || /share_trip_save/.test(r.text);
    return Response.json({ ok: false, reason: missing ? "Trip links aren't set up on this site yet." : "The link couldn't be made. Try again." }, { status: missing ? 503 : 502 });
  }
  const origin = new URL(req.url).origin;
  return Response.json({ ok: true, id, url: `${origin}/mission?share=${id}` });
}

export async function GET(req: Request) {
  if (tooManyReads(clientIp(req))) return Response.json({ ok: false, reason: "Too many requests." }, { status: 429 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ID.test(id)) return Response.json({ ok: false, reason: "That link isn't valid." }, { status: 400 });
  const r = await rpc<{ goal: string; snap: unknown; created_at: string }[]>("share_trip_get", { p_id: id });
  if (!r.ok) {
    console.error("[share] read failed", r.status, r.text);
    return Response.json({ ok: false, reason: "The trip couldn't be loaded. Try again." }, { status: 502 });
  }
  const row = r.data?.[0];
  if (!row) return Response.json({ ok: false, reason: "This trip link doesn't exist." }, { status: 404 });
  return Response.json({ ok: true, goal: row.goal, snap: row.snap, at: row.created_at }, { headers: { "Cache-Control": "public, max-age=300" } });
}
