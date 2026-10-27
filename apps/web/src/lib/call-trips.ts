// The "Call Backline" board: trips planned by phone in the last two days, newest first. Built from
// Vapi's own call records (plus this instance's memory, so a trip shows the moment the agent plans
// it). Shows a 4-digit code and the trip only: never the caller's number or email.
import { INBOUND_PATH, isBacklineCall, tripCode, tripFromCall, tripUrl, vapi, vapiReady, type CallTrip } from "./vapi";

const recent = new Map<string, { trip: CallTrip; at: number }>();
export function remember(callId: string, trip: CallTrip) {
  recent.set(callId, { trip, at: Date.now() });
  if (recent.size > 200) recent.delete(recent.keys().next().value as string);
}

export type BoardItem = { code: string; at: string; live: boolean; destination: string | null; days: number | null; travellers: number | null; loves: string | null; url: string | null };

const strip = (t: CallTrip | null) => (t ? { destination: t.destination, days: t.days, travellers: t.travellers, loves: t.loves, url: tripUrl(t) } : { destination: null, days: null, travellers: null, loves: null, url: null });

let numberCache: { at: number; number: string | null } = { at: 0, number: null };

/** The phone number that answers as Backline (the one whose server URL points here). */
export async function backlineNumber(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_BACKLINE_PHONE) return process.env.NEXT_PUBLIC_BACKLINE_PHONE;
  if (!vapiReady()) return null;
  if (Date.now() - numberCache.at < 5 * 60_000) return numberCache.number;
  const list = await vapi<Record<string, unknown>[]>("/phone-number?limit=50").catch(() => null);
  const ours = (list ?? []).filter((p) => {
    const url = String((p.server as { url?: string } | undefined)?.url ?? p.serverUrl ?? "");
    return url.includes(INBOUND_PATH) && typeof p.number === "string";
  });
  // A carrier number (Telnyx, Twilio) takes calls from anywhere; Vapi's free numbers are US-only.
  const hit = ours.find((p) => p.provider !== "vapi") ?? ours[0];
  numberCache = { at: Date.now(), number: (hit?.number as string | undefined) ?? null };
  return numberCache.number;
}

let boardCache: { at: number; items: BoardItem[] } = { at: 0, items: [] };

export async function board(): Promise<BoardItem[]> {
  if (!vapiReady()) return [];
  if (Date.now() - boardCache.at < 4000) return boardCache.items;
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const calls = await vapi<Record<string, unknown>[]>(`/call?limit=60&createdAtGt=${encodeURIComponent(since)}`).catch(() => null);
  const items: BoardItem[] = [];
  for (const c of calls ?? []) {
    if (!isBacklineCall(c)) continue;
    const id = String(c.id ?? "");
    if (!id) continue;
    const trip = tripFromCall(c) ?? recent.get(id)?.trip ?? null;
    const live = c.status !== "ended";
    if (!trip && !live) continue;
    items.push({ code: tripCode(id), at: String(c.createdAt ?? new Date().toISOString()), live, ...strip(trip) });
  }
  // Trips this instance planned that Vapi's list doesn't carry yet.
  for (const [id, r] of recent) {
    const code = tripCode(id);
    if (!items.some((i) => i.code === code)) items.push({ code, at: new Date(r.at).toISOString(), live: Date.now() - r.at < 6 * 60_000, ...strip(r.trip) });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  boardCache = { at: Date.now(), items: items.slice(0, 12) };
  return boardCache.items;
}

/** One call's trip, for the browser that's on that call (by Vapi's call id, which only that browser has). */
export async function tripForCall(callId: string): Promise<BoardItem | null> {
  const mem = recent.get(callId);
  if (mem) return { code: tripCode(callId), at: new Date(mem.at).toISOString(), live: true, ...strip(mem.trip) };
  if (!vapiReady()) return null;
  const c = await vapi<Record<string, unknown>>(`/call/${encodeURIComponent(callId)}`).catch(() => null);
  if (!c || !isBacklineCall(c)) return null;
  const trip = tripFromCall(c);
  return trip ? { code: tripCode(callId), at: String(c.createdAt ?? ""), live: c.status !== "ended", ...strip(trip) } : null;
}
