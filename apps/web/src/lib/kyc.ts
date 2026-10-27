// Identity checks (KYC) with Persona. The browser runs Persona's own flow; the server records which
// inquiry is whose and reads the result from Persona's API with the server key, checking that the
// inquiry was made for this account (its reference id is the account id).
import { rest } from "./supabase";
import type { Session } from "./session";

export type KycState = { configured: boolean; status: "none" | "pending" | "verified" | "declined" | "review"; inquiryId: string | null; checkedAt: string | null };

const API = "https://withpersona.com/api/v1";
const INQUIRY = /^inq_[A-Za-z0-9]{6,64}$/;

export const kycConfigured = () => Boolean(process.env.PERSONA_API_KEY && process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID);

type Inquiry = { status: string; referenceId: string | null };

/** The inquiry as Persona has it, or null. Pure fetch, no caching. */
async function fetchInquiry(id: string): Promise<Inquiry | null> {
  if (!INQUIRY.test(id) || !process.env.PERSONA_API_KEY) return null;
  const r = await fetch(`${API}/inquiries/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.PERSONA_API_KEY}`, "Persona-Version": "2023-01-05", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { data?: { attributes?: Record<string, unknown> } } | null;
  const a = j?.data?.attributes ?? {};
  return { status: String(a.status ?? ""), referenceId: (a["reference-id"] as string | undefined) ?? (a.referenceId as string | undefined) ?? null };
}

/** Persona's statuses in our words. Pure. */
export function kycStatus(s: string): KycState["status"] {
  if (s === "approved" || s === "completed") return "verified";
  if (s === "declined" || s === "failed") return "declined";
  if (s === "needs_review" || s === "marked_for_review") return "review";
  return s ? "pending" : "none";
}

const cache = new Map<string, { at: number; state: KycState }>();

export async function kycFor(s: Session, fresh = false): Promise<KycState> {
  if (!kycConfigured()) return { configured: false, status: "none", inquiryId: null, checkedAt: null };
  const hit = cache.get(s.user.id);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.state;
  const rows = await rest<{ inquiry_id: string }[]>(s.cfg, s.accessToken, `kyc_inquiries?select=inquiry_id&user_id=eq.${encodeURIComponent(s.user.id)}`).catch(() => []);
  const id = rows[0]?.inquiry_id ?? null;
  let state: KycState = { configured: true, status: "none", inquiryId: id, checkedAt: new Date().toISOString() };
  if (id) {
    const inq = await fetchInquiry(id);
    state = { ...state, status: inq && inq.referenceId === s.user.id ? kycStatus(inq.status) : "none" };
  }
  cache.set(s.user.id, { at: Date.now(), state });
  return state;
}

/** Record a finished inquiry, after checking with Persona that it was made for this account. */
export async function recordInquiry(s: Session, inquiryId: string): Promise<KycState> {
  const inq = await fetchInquiry(inquiryId);
  if (!inq || inq.referenceId !== s.user.id) throw new Error("That verification doesn't belong to this account.");
  await rest(s.cfg, s.accessToken, "kyc_inquiries?on_conflict=user_id", {
    method: "POST",
    body: { user_id: s.user.id, inquiry_id: inquiryId, updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  cache.delete(s.user.id);
  return kycFor(s, true);
}
