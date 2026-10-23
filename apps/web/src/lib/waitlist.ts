// Server-only waitlist store (import only from route handlers).
// Supabase in production; an in-memory store for local development.

export const ROLES = ["traveller", "business", "host", "agency", "other"] as const;
export type Role = (typeof ROLES)[number];

export interface JoinInput {
  email: string;
  role: Role;
  name?: string;
  artist?: string;
  country?: string;
  ref?: string;
  marketing: boolean;
  source?: string;
}

export type JoinResult =
  | { already: false; refCode: string; position: number; total: number }
  | { already: true; total: number };

export class WaitlistUnavailable extends Error {}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

export function waitlistMode(): "supabase" | "memory" | "off" {
  if (supabaseConfig()) return "supabase";
  return process.env.NODE_ENV === "production" ? "off" : "memory";
}

export async function joinWaitlist(input: JoinInput): Promise<JoinResult> {
  const mode = waitlistMode();
  if (mode === "off") throw new WaitlistUnavailable("Supabase is not configured");
  return mode === "supabase" ? joinSupabase(input) : joinMemory(input);
}

async function joinSupabase(input: JoinInput): Promise<JoinResult> {
  const { url, key } = supabaseConfig()!;
  // New-style secret keys (sb_secret_…) go in the apikey header only; legacy service-role JWTs also go in Authorization.
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(`${url}/rest/v1/rpc/waitlist_join`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      p_email: input.email,
      p_role: input.role,
      p_name: input.name ?? null,
      p_artist: input.artist ?? null,
      p_country: input.country ?? null,
      p_ref: input.ref ?? null,
      p_marketing: input.marketing,
      p_source: input.source ?? null,
    }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Supabase waitlist_join failed: ${res.status} ${detail}`);
  }
  const rows = (await res.json()) as { already: boolean; ref_code: string | null; queue_position: number | null; total: number }[];
  const row = rows[0];
  if (!row) throw new Error("Supabase waitlist_join returned no row");
  return row.already
    ? { already: true, total: row.total }
    : { already: false, refCode: row.ref_code!, position: row.queue_position!, total: row.total };
}

// ---------- Local development store (resets when the dev server restarts) ----------

interface MemRow extends JoinInput {
  refCode: string;
  referrals: number;
  at: number;
}
const g = globalThis as unknown as { __waitlist?: Map<string, MemRow> };
const mem = (g.__waitlist ??= new Map());
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const DAY = 86_400_000;

function code() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
const score = (r: MemRow) => r.at - Math.min(r.referrals, 30) * 2 * DAY;

async function joinMemory(input: JoinInput): Promise<JoinResult> {
  const email = input.email.toLowerCase();
  if (mem.has(email)) return { already: true, total: mem.size };
  const referrer = input.ref ? [...mem.values()].find((r) => r.refCode === input.ref!.toLowerCase()) : undefined;
  const row: MemRow = { ...input, email, refCode: code(), referrals: 0, at: Date.now() };
  mem.set(email, row);
  if (referrer) referrer.referrals += 1;
  const position = 1 + [...mem.values()].filter((r) => score(r) < score(row)).length;
  return { already: false, refCode: row.refCode, position, total: mem.size };
}

// ---------- Confirmation email (optional; sent only when Resend is configured) ----------

export async function sendConfirmation(to: string, opts: { position: number; referralUrl: string; productName: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.WAITLIST_FROM_EMAIL;
  if (!apiKey || !from) return false;

  const text = [
    `You're #${opts.position} on the ${opts.productName} waitlist.`,
    "",
    "Move up the list: share your link. Every person who joins with it moves you up.",
    opts.referralUrl, "", "If you didn't sign up, ignore this email and you won't hear from us again."].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `You're on the ${opts.productName} waitlist`, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
  return true;
}
