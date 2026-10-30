// What's on while they're there: concerts, festivals, sport, theatre, exhibitions, markets, food and
// nightlife events in the city during the exact travel dates, found on the web and ranked by the
// person's Qloo taste. Only events whose date the sources confirm, inside the trip, are kept.
import { z } from "zod";
import type { BriefInput, Evidence, Skill, SkillContext } from "../types";
import type { WebResult } from "../clients/web";
import { UNTRUSTED_WEB_RULE, languageRule, quoteWeb, webEvidence } from "../grounding";
import type { TasteOutput } from "./taste";
import { agentOf, tripDates } from "./trip";
import { withTimeout } from "../util";

export const EVENT_KINDS = ["concert", "festival", "sport", "theatre", "comedy", "exhibition", "market", "food", "nightlife", "tour", "other"] as const;

const eventSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(EVENT_KINDS),
  /** First day it's on (YYYY-MM-DD), within the trip. */
  date: z.string(),
  /** Last day, for multi-day events. */
  endDate: z.string().nullable(),
  /** "20:00", when the source gives it. */
  time: z.string().nullable(),
  venue: z.string().nullable(),
  price: z.string().nullable(),
  /** Why it suits them, from their taste. */
  why: z.string().nullable(),
  /** 0–1: how well it fits their taste. */
  fit: z.number(),
  url: z.string(),
  site: z.string(),
});
export type TripEvent = z.infer<typeof eventSchema>;

const eventsOutput = z.object({
  city: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  events: z.array(eventSchema),
  /** Event listing pages for the dates, to browse when nothing could be dated (or for more). */
  listings: z.array(z.object({ title: z.string(), url: z.string(), site: z.string() })),
  gaps: z.array(z.string()),
});
export type TripEventsOutput = z.infer<typeof eventsOutput>;

const rawSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.string(),
        kind: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        time: z.string().nullable().optional(),
        venue: z.string().nullable().optional(),
        price: z.string().nullable().optional(),
        why: z.string().nullable().optional(),
        fit: z.coerce.number().nullable().optional().catch(null),
        source: z.string().nullable().optional(),
      })
    )
    .default([]),
});

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (d: string | null | undefined) => {
  if (!d || !ISO.test(d)) return null;
  const x = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(+x) && x.toISOString().slice(0, 10) === d ? d : null;
};
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "November 2026", "November–December 2026": the months the trip covers (at most three, for searching). Pure. */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const endKey = +to.slice(0, 4) * 12 + +to.slice(5, 7);
  while (y * 12 + m <= endKey && out.length < 3) {
    out.push(`${MONTH_NAMES[m - 1]} ${y}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * The model's reading of the sources into events: only those with a real date inside the trip and a
 * source, deduplicated, best fit first. Pure.
 */
export function shapeEvents(raw: z.infer<typeof rawSchema>, sources: WebResult[], from: string, to: string): TripEvent[] {
  const byId = new Map(sources.map((s, i) => [`w${i + 1}`, s]));
  const seen = new Set<string>();
  const out: TripEvent[] = [];
  for (const e of raw.events) {
    const src = byId.get((e.source ?? "").trim().toLowerCase());
    const name = clean(e.name, 120);
    const date = realDay(e.date);
    if (!src || !name || !date) continue;
    let end = realDay(e.endDate);
    if (end && end < date) end = null;
    // On during the trip: starts inside it, or a run that's still on when they arrive.
    if (date > to || (end ?? date) < from) continue;
    const key = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = (EVENT_KINDS as readonly string[]).includes((e.kind ?? "").toLowerCase()) ? ((e.kind ?? "").toLowerCase() as TripEvent["kind"]) : "other";
    const time = clean(e.time, 12);
    out.push({
      id: "",
      name,
      kind,
      date: date < from ? from : date,
      endDate: end,
      time: /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, "0") : null,
      venue: clean(e.venue, 120) || null,
      price: clean(e.price, 60) || null,
      why: clean(e.why, 200) || null,
      fit: Math.max(0, Math.min(1, Number.isFinite(e.fit) ? Number(e.fit) : 0.5)),
      url: src.url,
      site: hostOf(src.url),
    });
  }
  return out
    .sort((a, b) => b.fit - a.fit || a.date.localeCompare(b.date))
    .slice(0, 24)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"))
    .map((e, i) => ({ ...e, id: `e${i + 1}` }));
}

async function search(ctx: SkillContext, q: string): Promise<WebResult[]> {
  if (!ctx.web) return [];
  const ac = new AbortController();
  const stop = () => ac.abort();
  ctx.signal?.addEventListener("abort", stop);
  try {
    return await withTimeout(ctx.web.search(q, { maxResults: 6, need: "booking", signal: ac.signal }), 30_000, "events search");
  } catch (err) {
    ac.abort();
    ctx.log.warn("events search failed", { error: String(err).slice(0, 160) });
    return [];
  } finally {
    ctx.signal?.removeEventListener("abort", stop);
  }
}

export const tripEvents: Skill<BriefInput, TripEventsOutput> = {
  id: "trip.events",
  title: "Finding what's on while you're there",
  dependsOn: ["trip.agent"],
  optionalDeps: ["trip.taste"],
  timeoutMs: 80_000,
  output: eventsOutput,
  async run(ctx, input, deps) {
    const a = agentOf(deps);
    const taste = deps["trip.taste"]?.data as TasteOutput | undefined;
    const city = a.where.city ? [a.where.city.name, a.where.city.country].filter(Boolean).join(", ") : a.trip.destination;
    const dates = tripDates(a.trip.startDate, a.trip.endDate);
    const none = (gaps: string[]) => ({ data: { city, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, events: [], listings: [], gaps }, evidence: [] as Evidence[], notes: [] as string[] });
    if (!dates.length) return none(["Events (no dates yet)"]);
    if (!ctx.web) return none(["Events (web research is off)"]);
    const from = dates[0], to = dates[dates.length - 1];
    const months = monthsOf(from, to);
    const when = months.join(" ");
    const place = a.where.city?.name ?? a.trip.destination.split(",")[0];
    // The tastes to look for events by: what they named first, then what Qloo read from it.
    const tastes = [...(a.trip.likes ?? []), ...(a.trip.inspiredBy ? [a.trip.inspiredBy] : []), ...(taste?.signals ?? []).map((s) => s.name), ...(taste?.tags ?? []).map((t) => t.name)]
      .map((x) => x.trim())
      .filter((x, i, all) => x && all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
      .slice(0, 3);
    ctx.progress?.({ kind: "act", id: "ev.find", tool: "events", text: `Looking for events in ${place} ${dates.length === 1 ? `on ${from}` : `from ${from} to ${to}`}`, by: "autopilot" });
    const t0 = Date.now();
    const queries = [
      `${place} events ${when}`,
      `${place} concerts ${when}`,
      `${place} festivals and things to do ${when}`,
      `${place} what's on ${months[0]} ticketmaster OR eventbrite OR songkick OR "time out"`,
      ...tastes.map((x) => `${place} ${x} event OR concert OR show ${when}`),
    ];
    const results = await Promise.all(queries.map((q) => search(ctx, q)));
    const seen = new Set<string>();
    const sources = results.flat().filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true))).slice(0, 24);
    const listings = sources.slice(0, 6).map((s) => ({ title: clean(s.title, 120) || hostOf(s.url), url: s.url, site: hostOf(s.url) }));
    if (!sources.length) {
      ctx.progress?.({ kind: "saw", id: "ev.find", tool: "events", ok: false, text: "No event listings found", ms: Date.now() - t0, by: "autopilot" });
      return none(["Events for your dates"]);
    }
    if (!ctx.llm) {
      ctx.progress?.({ kind: "saw", id: "ev.find", tool: "events", ok: true, text: `${listings.length} event listings to browse`, ms: Date.now() - t0, by: "autopilot" });
      return { data: { city, from, to, events: [], listings, gaps: [] }, evidence: listings.map((l) => webEvidence(sources.find((s) => s.url === l.url)!)), notes: [] };
    }
    try {
      const raw = await ctx.llm.json({
        tier: "default",
        schema: rawSchema,
        maxTokens: 3000,
        temperature: 0.1,
        timeoutMs: 40_000,
        signal: ctx.signal,
        purpose: "events",
        system: [
          `You list real events in ${city} on between ${from} and ${to} (inclusive): concerts, festivals, sport, theatre, comedy, exhibitions, markets, food and nightlife events, tours.`,
          "Use only the numbered sources. Every event needs the source id it came from and a specific date (YYYY-MM-DD) stated or clearly implied by that source for these dates. Skip anything without a date, outside the dates, or in another city. Don't invent events, times, venues or prices.",
          `Today the trip runs ${from} to ${to}; a multi-day event that's on during it counts (date = first day, endDate = last day).`,
          "kind: concert | festival | sport | theatre | comedy | exhibition | market | food | nightlife | tour | other. time as 24-hour HH:MM if given. price as written (e.g. \"from CA$45\"), else null.",
          tastes.length || taste
            ? `Their taste, read through Qloo: ${[...tastes, ...(taste?.vibes ?? []), ...(taste?.scenes ?? [])].slice(0, 10).join(", ")}. fit is 0 to 1 for how much they'd enjoy it; why is one short line saying how it fits their taste.`
            : "fit is 0 to 1 for how good the event is for a visitor; why is one short line.",
          "At most 20 events, best fit first.",
          UNTRUSTED_WEB_RULE,
          languageRule(input),
          'Shape: {"events":[{"name":"…","kind":"concert","date":"2026-11-05","endDate":null,"time":"20:00","venue":"…","price":"from CA$45","why":"…","fit":0.9,"source":"w3"}]}',
        ].join("\n"),
        user: [`City: ${city}`, `Dates: ${from} to ${to}`, "", quoteWeb(sources)].join("\n"),
      });
      const events = shapeEvents(rawSchema.parse(raw), sources, from, to);
      ctx.progress?.({ kind: "saw", id: "ev.find", tool: "events", ok: true, text: events.length ? `${events.length} events on during your trip` : "No dated events found; listings to browse", ms: Date.now() - t0, by: "autopilot" });
      const used = new Set(events.map((e) => e.url));
      return {
        data: { city, from, to, events, listings, gaps: events.length ? [] : ["Dated events for your trip"] },
        evidence: sources.filter((s) => used.has(s.url)).map((s) => webEvidence(s)),
        notes: [],
      };
    } catch (err) {
      ctx.log.warn("Trip events failed", { error: String(err) });
      return { data: { city, from, to, events: [], listings, gaps: ["Dated events for your trip"] }, evidence: [], notes: [] };
    }
  },
};
