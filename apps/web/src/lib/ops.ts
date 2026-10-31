// What the private monitoring page (/ops) shows: who may see it, and a small in-memory record of
// this server instance's recent missions and warnings/errors. Never holds keys, tokens or personal
// details beyond the first words of a request. Per instance and lost on restart, like any log tail.
import { getSession, type Session } from "./session";

/** Signed in with an email listed in ADMIN_EMAILS (comma-separated). Everyone else gets a 404. */
export async function opsSession(): Promise<Session | null> {
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return null;
  const s = await getSession().catch(() => null);
  const email = s?.user.email?.toLowerCase();
  return s && email && allowed.includes(email) ? s : null;
}

export type OpsRun = { at: number; goal: string; status: string; ms: number; planner: string | null; failed: string[]; signedIn: boolean; country: string | null };
export type OpsLog = { at: number; level: "warn" | "error"; msg: string };

type Store = { runs: OpsRun[]; logs: OpsLog[]; started: number; counts: { missions: number; failed: number } };
const g = globalThis as unknown as { __ops?: Store };
export const ops: Store = (g.__ops ??= { runs: [], logs: [], started: Date.now(), counts: { missions: 0, failed: 0 } });

const SECRETISH = /(sk-|gsk_|sand_|prod_|duffel_(?:test|live)_|eyJ[\w-]{10,}|Bearer\s+\S+|api[_-]?key\S*)/gi;
const scrub = (s: string) => s.replace(SECRETISH, "[hidden]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\+?\d[\d\s-]{8,}\d/g, "[number]");

export function recordRun(r: Omit<OpsRun, "at" | "goal"> & { goal: string }): void {
  ops.counts.missions += 1;
  if (r.status === "failed" || r.failed.length) ops.counts.failed += 1;
  ops.runs.unshift({ ...r, goal: scrub(r.goal).slice(0, 90), at: Date.now() });
  ops.runs.length = Math.min(ops.runs.length, 60);
}

export function recordLog(level: OpsLog["level"], parts: unknown[]): void {
  const msg = parts.map((p) => (p instanceof Error ? p.message : typeof p === "string" ? p : (() => { try { return JSON.stringify(p); } catch { return String(p); } })())).join(" ");
  ops.logs.unshift({ at: Date.now(), level, msg: scrub(msg).slice(0, 400) });
  ops.logs.length = Math.min(ops.logs.length, 120);
}

/** Totals from the database, when its secret key is set (SUPABASE_SECRET_KEY). Counts only. */
export async function usageCounts(): Promise<Record<string, number | null> | null> {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const count = async (path: string): Promise<number | null> => {
    try {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" }, signal: AbortSignal.timeout(6000) });
      const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  };
  const [accounts, trips, trips24, searches24, payments, verified] = await Promise.all([
    count("profiles?select=user_id"),
    count("trips?select=id"),
    count(`trips?select=id&created_at=gte.${since}`),
    count(`searches?select=id&created_at=gte.${since}`),
    count("wallet_entries?select=id&kind=eq.payment"),
    count("kyc_inquiries?select=id&status=eq.approved"),
  ]);
  return { accounts, trips, "trips (24h)": trips24, "searches (24h)": searches24, "wallet payments": payments, "verified identities": verified };
}

/** Which settings are present and in which mode. Names and modes only, never values. */
export function configSummary(): { name: string; set: boolean; note?: string }[] {
  const e = process.env;
  const mode = (v: string | undefined, test: string, label: [string, string]) => (v ? (v.startsWith(test) ? label[0] : label[1]) : undefined);
  return [
    { name: "AI model 1 (LLM_*)", set: Boolean(e.LLM_API_KEY && e.LLM_MODEL), note: e.LLM_MODEL },
    { name: "AI model 2 (LLM2_*)", set: Boolean(e.LLM2_API_KEY && e.LLM2_MODEL), note: e.LLM2_MODEL },
    { name: "AI model 3 (LLM3_*)", set: Boolean(e.LLM3_API_KEY && e.LLM3_MODEL), note: e.LLM3_MODEL },
    { name: "Qloo", set: Boolean(e.QLOO_API_KEY) },
    { name: "Web research: Tavily", set: Boolean(e.TAVILY_API_KEY) },
    { name: "Web research: Claude", set: Boolean(e.ANTHROPIC_API_KEY) },
    { name: "Hotels: LiteAPI", set: Boolean(e.LITEAPI_API_KEY), note: mode(e.LITEAPI_API_KEY, "sand", ["sandbox (test rates)", "live"]) },
    { name: "Flights: Duffel", set: Boolean(e.DUFFEL_API_KEY), note: mode(e.DUFFEL_API_KEY, "duffel_test", ["test", "live"]) },
    { name: "Calls: Vapi", set: Boolean(e.VAPI_API_KEY), note: e.CALLS_LIVE === "1" ? "live: rings businesses" : "demo: rings your own number" },
    { name: "Vapi webhook secret", set: Boolean(e.VAPI_WEBHOOK_SECRET) },
    { name: "Email: Resend", set: Boolean(e.RESEND_API_KEY) },
    { name: "Voice: speech-to-text", set: Boolean(e.STT_API_KEY), note: e.STT_MODEL },
    { name: "Identity: Persona", set: Boolean(e.PERSONA_API_KEY) },
    { name: "Sign-in: Supabase", set: Boolean((e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL) && (e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) },
    { name: "Google sign-in (own client)", set: Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) },
    { name: "Plan seal key", set: Boolean(e.RUN_SEAL_KEY || e.SUPABASE_SECRET_KEY || e.TRAVEL_DOCS_KEY) },
    { name: "Passport encryption key", set: Boolean(e.TRAVEL_DOCS_KEY) },
    { name: "Usage counts (Supabase secret key)", set: Boolean(e.SUPABASE_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY) },
    { name: "Google 3D city tiles", set: Boolean(e.NEXT_PUBLIC_GOOGLE_MAPS_KEY) },
  ];
}
