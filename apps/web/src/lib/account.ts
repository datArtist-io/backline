// A signed-in person's saved details, trips and memories, and how they shape the next trip.
// Server-only: every call goes through Supabase as that person (row-level security).
import { cleanProfile, type Profile, type SkillResult, type TripAgentOutput, type TripExecuteOutput, type TripActionsOutput, type TripPlanOutput, type TripFlightsOutput } from "@backline/engine";
import { rest } from "./supabase";
import type { Session } from "./session";

export type Memory = { id: string; kind: "like" | "stayed" | "visited" | "note"; value: string; source: string | null; created_at: string };
export type SavedTrip = { id: string; title: string; goal: string | null; destination: string | null; start_date: string | null; end_date: string | null; summary: string | null; details: TripDetails; created_at: string };
export type TripDetails = {
  bookings: { title: string; status: string; ref: string | null; message: string }[];
  days: { date: string | null; label: string; items: { time: string; title: string }[] }[];
  budget: { item: string; amount: number | null; currency: string }[];
  stay: string | null;
  flight: string | null;
};

export async function loadAccount(s: Session): Promise<{ profile: Profile; memories: Memory[]; trips: SavedTrip[] }> {
  const id = encodeURIComponent(s.user.id);
  const [p, memories, trips] = await Promise.all([
    rest<{ details: unknown }[]>(s.cfg, s.accessToken, `profiles?select=details&user_id=eq.${id}`),
    rest<Memory[]>(s.cfg, s.accessToken, `memories?select=id,kind,value,source,created_at&order=created_at.desc&limit=100`),
    rest<SavedTrip[]>(s.cfg, s.accessToken, `trips?select=id,title,goal,destination,start_date,end_date,summary,details,created_at&order=created_at.desc&limit=50`),
  ]);
  return { profile: cleanProfile(p[0]?.details ?? {}), memories, trips };
}

export async function saveAccountProfile(s: Session, profile: Profile): Promise<void> {
  await rest(s.cfg, s.accessToken, "profiles?on_conflict=user_id", {
    method: "POST",
    body: { user_id: s.user.id, details: cleanProfile(profile), updated_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

export async function forgetMemory(s: Session, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await rest(s.cfg, s.accessToken, `memories?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

export async function deleteTrip(s: Session, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await rest(s.cfg, s.accessToken, `trips?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
}

/**
 * The profile a mission runs with: what they saved in their account, filled in by anything newer
 * from this browser, plus what the agent remembers (tastes become likes; places become notes). Pure.
 */
export function mergeProfile(saved: Profile, local: Profile, memories: Pick<Memory, "kind" | "value">[]): Profile {
  const base: Profile = { ...saved };
  for (const [k, v] of Object.entries(local) as [keyof Profile, unknown][]) {
    if (v == null || (Array.isArray(v) && v.length === 0) || v === "") continue;
    if ((base as Record<string, unknown>)[k] == null) (base as Record<string, unknown>)[k] = v;
  }
  const remembered = memories.filter((m) => m.kind === "like").map((m) => m.value);
  const likes = [...new Set([...(base.likes ?? []), ...remembered].map((x) => x.trim()).filter(Boolean))].slice(0, 12);
  const places = memories.filter((m) => m.kind === "stayed" || m.kind === "visited").slice(0, 6);
  const notes = [base.notes, places.length ? `From past trips: ${places.map((m) => (m.kind === "stayed" ? `stayed at ${m.value}` : `visited ${m.value}`)).join("; ")}.` : null].filter(Boolean).join(" ");
  return cleanProfile({ ...base, likes: likes.length ? likes : undefined, notes: notes ? notes.slice(0, 600) : undefined });
}

type Results = Record<string, SkillResult<unknown> | undefined>;

/** A compact record of a finished trip to save, or null if the mission wasn't a trip. Pure. */
export function tripRecord(goal: string, title: string, results: Results): Omit<SavedTrip, "id" | "created_at"> | null {
  const agent = results["trip.agent"]?.data as TripAgentOutput | undefined;
  if (!agent) return null;
  const plan = results["trip.plan"]?.data as TripPlanOutput | undefined;
  const actions = (results["trip.actions"]?.data as TripActionsOutput | undefined)?.actions ?? [];
  const done = (results["trip.execute"]?.data as TripExecuteOutput | undefined)?.results ?? [];
  const flight = (results["trip.flights"]?.data as TripFlightsOutput | undefined)?.flight ?? null;
  const stayId = plan?.stayId ?? agent.picks.stays[0];
  const stay = agent.stays.find((p) => p.id === stayId) ?? null;
  const t = agent.trip;
  return {
    title: title.slice(0, 160),
    goal: goal.slice(0, 2000),
    destination: (agent.where.city ? [agent.where.city.name, agent.where.city.country].filter(Boolean).join(", ") : t.destination).slice(0, 120) || null,
    start_date: t.startDate,
    end_date: t.endDate,
    summary: (plan?.summary || agent.summary || "").slice(0, 2000) || null,
    details: {
      bookings: done.map((r) => ({ title: actions.find((a) => a.id === r.actionId)?.title ?? "", status: r.status, ref: r.ref, message: r.message.slice(0, 300) })),
      days: (plan?.days ?? []).map((d) => ({ date: d.date, label: d.label, items: d.items.map((i) => ({ time: i.time, title: i.title })) })),
      budget: (plan?.budget ?? []).map((b) => ({ item: b.item, amount: b.amount, currency: b.currency })),
      stay: stay?.name ?? null,
      flight: flight ? `${flight.airline ?? "Flight"} ${flight.outbound.from}→${flight.outbound.to}` : null,
    },
  };
}

/** What to remember from a trip: the tastes they named, where they went and where they stayed. Pure. */
export function memoriesFrom(record: Omit<SavedTrip, "id" | "created_at">, trip: { likes?: string[]; inspiredBy?: string | null } | null): Pick<Memory, "kind" | "value" | "source">[] {
  const source = record.title.slice(0, 160);
  const out: Pick<Memory, "kind" | "value" | "source">[] = [];
  for (const l of trip?.likes ?? []) out.push({ kind: "like", value: l.slice(0, 200), source });
  if (trip?.inspiredBy) out.push({ kind: "like", value: trip.inspiredBy.slice(0, 200), source });
  if (record.destination) out.push({ kind: "visited", value: record.destination, source });
  const booked = record.details.bookings.some((b) => b.status === "booked" && /stay|hotel|room/i.test(b.title));
  if (record.details.stay && booked) out.push({ kind: "stayed", value: `${record.details.stay}${record.destination ? `, ${record.destination.split(",")[0]}` : ""}`.slice(0, 200), source });
  return out;
}

/** Save a finished trip and what to remember from it. Failures are logged, never shown. */
export async function saveTripAndMemories(s: Session, goal: string, title: string, results: Results): Promise<void> {
  const record = tripRecord(goal, title, results);
  if (!record) return;
  const trip = (results["trip.agent"]?.data as TripAgentOutput | undefined)?.trip ?? null;
  await rest(s.cfg, s.accessToken, "trips", { method: "POST", body: { ...record, user_id: s.user.id }, prefer: "return=minimal" });
  const mems = memoriesFrom(record, trip);
  if (mems.length)
    await rest(s.cfg, s.accessToken, "memories?on_conflict=user_id,kind,value", {
      method: "POST",
      body: mems.map((m) => ({ ...m, user_id: s.user.id })),
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
}
