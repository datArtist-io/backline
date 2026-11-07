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
export const scrub = (s: string) => s.replace(SECRETISH, "[hidden]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\+?\d[\d\s-]{8,}\d/g, "[number]");

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

// ---------- one structured record per planning run ----------
// Written to stdout as one JSON line (Vercel keeps it; a log drain can send it to Axiom, Logtail or a
// table). It holds what a query needs to find a sick run (the bug-finding book, section 8.2) and
// nothing personal: no request text, no names, no email, no phone.

export type RunRecord = {
  bl: "run";
  run_id: string;
  at: string;
  source: "web" | "voice" | "share" | "synthetic";
  request: { city: string | null; origin: string | null; days: number | null; travellers: number | null; budget: number | null; currency: string | null };
  model: { used: string | null; calls: number; failed: number; failovers: number };
  turns: number | null;
  calls: number | null;
  elapsed_ms: number;
  tools: Record<string, { calls: number; fail: number; ms: number }>;
  autopilot: boolean;
  method: string | null;
  stop: string | null;
  finish_sent_back: number;
  prices: { flight: "live" | "listed" | "estimate" | "none"; hotel: "live" | "listed" | "estimate" | "test" | "none" };
  steps: { failed: string[]; skipped: string[] };
  outcome: string;
  signed_in: boolean;
  country: string | null;
};

type AgentStats = { turns: number; calls: number; stop: string; trace?: { by: string; note?: string; calls: { tool: string; ok: boolean; ms: number }[] }[] };
type Results = Record<string, { data?: unknown } | undefined>;

/** Builds the record from a finished run's results. Pure, and tolerant of missing steps. */
export function runRecord(p: {
  runId: string;
  source: RunRecord["source"];
  results: Results;
  steps: Record<string, { status?: string }>;
  status: string;
  ms: number;
  llmCalls: { model: string; ok: boolean }[];
  signedIn: boolean;
  country: string | null;
}): RunRecord {
  const agent = p.results["trip.agent"]?.data as { trip?: { destination?: string; origin?: string | null; startDate?: string | null; endDate?: string | null; adults?: number; budget?: { amount: number | null; currency: string } }; method?: string; stats?: AgentStats } | undefined;
  const trip = agent?.trip;
  const days = trip?.startDate && trip?.endDate ? Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 864e5) + 1 : null;
  const tools: RunRecord["tools"] = {};
  let sentBack = 0;
  for (const t of agent?.stats?.trace ?? []) {
    if (t.note && /sent back|check/i.test(t.note)) sentBack++;
    for (const c of t.calls) {
      const row = (tools[c.tool] ??= { calls: 0, fail: 0, ms: 0 });
      row.calls++;
      if (!c.ok) row.fail++;
      row.ms += c.ms;
    }
  }
  const actions = (p.results["trip.actions"]?.data as { actions?: { kind: string; subject?: string | null }[] } | undefined)?.actions ?? [];
  const travel = actions.find((a) => a.kind === "book_travel" || a.kind === "book_flight");
  const flight: RunRecord["prices"]["flight"] = !travel ? "none" : /estimated/i.test(travel.subject ?? "") ? "estimate" : /listed/i.test(travel.subject ?? "") ? "listed" : "live";
  const budget = (p.results["trip.plan"]?.data as { budget?: { item: string; basis: string }[] } | undefined)?.budget ?? [];
  const stayLine = budget.find((b) => /night/i.test(b.item));
  const hotel: RunRecord["prices"]["hotel"] = !stayLine ? "none" : /live rate/i.test(stayLine.basis) ? "live" : /listed/i.test(stayLine.basis) ? "listed" : /test-mode/i.test(stayLine.basis) ? "test" : "estimate";
  const used = [...p.llmCalls].reverse().find((c) => c.ok)?.model ?? null;
  const models = new Set(p.llmCalls.filter((c) => c.ok).map((c) => c.model));
  return {
    bl: "run",
    run_id: p.runId,
    at: new Date().toISOString(),
    source: p.source,
    request: { city: trip?.destination?.split(",")[0]?.trim() ?? null, origin: trip?.origin?.split(",")[0]?.trim() ?? null, days, travellers: trip?.adults ?? null, budget: trip?.budget?.amount ?? null, currency: trip?.budget?.currency ?? null },
    model: { used, calls: p.llmCalls.length, failed: p.llmCalls.filter((c) => !c.ok).length, failovers: Math.max(0, models.size - 1) },
    turns: agent?.stats?.turns ?? null,
    calls: agent?.stats?.calls ?? null,
    elapsed_ms: p.ms,
    tools,
    autopilot: agent?.method === "autopilot",
    method: agent?.method ?? null,
    stop: agent?.stats?.stop ?? null,
    finish_sent_back: sentBack,
    prices: { flight, hotel },
    steps: {
      failed: Object.entries(p.steps).filter(([, s]) => s.status === "failed").map(([id]) => id),
      skipped: Object.entries(p.steps).filter(([, s]) => s.status === "skipped").map(([id]) => id),
    },
    outcome: p.status === "failed" ? "failed" : agent?.method === "autopilot" ? "autopilot" : p.status,
    signed_in: p.signedIn,
    country: p.country,
  };
}

/** Writes the record as one line, so a log drain can index it. */
export function logRun(r: RunRecord): void {
  console.log(JSON.stringify(r));
}
