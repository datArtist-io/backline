// "Getting there": how to actually travel from home to the destination. Real options (flight, train,
// bus, car, ferry) with typical durations and price ranges read from the web and cited, instead of a
// test airline's made-up fare. If the route is short, flights aren't offered unless the sources say they exist.
import { z } from "zod";
import type { BriefInput, Evidence, Skill } from "../types";
import type { WebResult } from "../clients/web";
import { UNTRUSTED_WEB_RULE, languageRule, quoteWeb, webEvidence } from "../grounding";
import { withTimeout } from "../util";

export const MODES = ["flight", "train", "bus", "car", "ferry", "other"] as const;
export type TravelMode = (typeof MODES)[number];

const optionSchema = z.object({
  mode: z.enum(MODES),
  title: z.string(),
  /** "about 2 h 30 min", as the source gives it. */
  duration: z.string().nullable(),
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  currency: z.string().nullable(),
  note: z.string().nullable(),
  url: z.string().nullable(),
  site: z.string().nullable(),
  verified: z.boolean(),
  best: z.boolean(),
});

const travelOutput = z.object({
  origin: z.string().nullable(),
  destination: z.string().nullable(),
  /** Straight-line distance, km. */
  km: z.number().nullable(),
  /** Coordinates of home and the destination, for drawing the journey. */
  from: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  to: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  options: z.array(optionSchema),
  gaps: z.array(z.string()),
});
export type TripTravelOutput = z.infer<typeof travelOutput>;
export type TravelOption = z.infer<typeof optionSchema>;

const rawSchema = z.object({
  options: z
    .array(
      z.object({
        mode: z.string(),
        title: z.string(),
        duration: z.string().nullable().optional(),
        priceMin: z.number().nullable().optional(),
        priceMax: z.number().nullable().optional(),
        currency: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        best: z.boolean().nullable().optional(),
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

/** Great-circle distance in km. Pure. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Turns the model's reading of the sources into cited options. A price without a source is dropped; one option is marked best. Pure. */
export function shapeTravel(raw: z.infer<typeof rawSchema>, sources: WebResult[]): { options: TravelOption[]; used: WebResult[] } {
  const byId = new Map(sources.map((s, i) => [`w${i + 1}`, s]));
  const used = new Set<string>();
  const options: TravelOption[] = [];
  for (const o of raw.options) {
    const mode = (MODES as readonly string[]).includes(o.mode) ? (o.mode as TravelMode) : "other";
    const src = byId.get((o.source ?? "").trim().toLowerCase()) ?? null;
    if (src) used.add((o.source ?? "").trim().toLowerCase());
    const priced = src && o.priceMin != null && o.priceMin > 0;
    const min = priced ? o.priceMin! : null;
    const max = priced ? Math.max(o.priceMax ?? o.priceMin!, o.priceMin!) : null;
    const title = clean(o.title, 90);
    if (!title) continue;
    options.push({
      mode,
      title,
      duration: clean(o.duration, 40) || null,
      priceMin: min,
      priceMax: max,
      currency: priced ? clean(o.currency, 5).toUpperCase() || null : null,
      note: clean(o.note, 200) || null,
      url: src?.url ?? null,
      site: src ? hostOf(src.url) : null,
      verified: Boolean(src),
      best: Boolean(o.best),
    });
  }
  const top = options.slice(0, 4);
  if (top.length && !top.some((o) => o.best)) top[0].best = true;
  let seen = false;
  for (const o of top) {
    if (o.best && seen) o.best = false;
    if (o.best) seen = true;
  }
  return { options: top, used: [...used].map((id) => byId.get(id)!) };
}

async function search(ctx: Parameters<NonNullable<Skill["run"]>>[0], q: string): Promise<WebResult[]> {
  if (!ctx.web) return [];
  try {
    return await withTimeout(ctx.web.search(q, { maxResults: 5, need: "facts", signal: ctx.signal }), 14000, "travel search");
  } catch {
    return [];
  }
}

const city = (x: string) => x.split(",")[0].trim().toLowerCase();

export const tripTravel: Skill<BriefInput, TripTravelOutput> = {
  id: "trip.travel",
  title: "Working out how to get there",
  dependsOn: [],
  timeoutMs: 55_000,
  output: travelOutput,
  async run(ctx, input) {
    const t = input.trip;
    const none = (gaps: string[] = []) => ({ data: { origin: null, destination: null, km: null, from: null, to: null, options: [], gaps }, evidence: [] as Evidence[], notes: gaps });
    if (!t?.destination) return none();
    const origin = (t.origin ?? input.profile?.homeCity ?? "").trim();
    if (!origin || city(origin) === city(t.destination)) return none();
    ctx.progress?.({ kind: "act", id: "tr.find", tool: "travel", text: `Working out how to get from ${origin} to ${t.destination}`, by: "autopilot" });
    const t0 = Date.now();
    let km: number | null = null;
    let from: { lat: number; lon: number } | null = null;
    let to: { lat: number; lon: number } | null = null;
    if (ctx.osm) {
      try {
        const [a, b] = await Promise.all([ctx.osm.geocode(origin, { limit: 1, signal: ctx.signal }), ctx.osm.geocode(t.destination, { limit: 1, signal: ctx.signal })]);
        if (a[0]) from = { lat: a[0].lat, lon: a[0].lon };
        if (b[0]) to = { lat: b[0].lat, lon: b[0].lon };
        if (a[0] && b[0]) km = haversineKm(a[0], b[0]);
      } catch {
        /* distance is a nicety */
      }
    }
    const year = (t.startDate ?? new Date().toISOString()).slice(0, 4);
    const [all, fares] = await Promise.all([
      search(ctx, `how to travel from ${origin} to ${t.destination} train bus flight drive time cost ${year}`),
      search(ctx, `${origin} to ${t.destination} ticket price fare ${year}`),
    ]);
    const seen = new Set<string>();
    const sources = [...all, ...fares].filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true))).slice(0, 10);
    if (!ctx.llm || sources.length === 0) {
      ctx.progress?.({ kind: "saw", id: "tr.find", tool: "travel", ok: false, text: "No travel sources found", ms: Date.now() - t0, by: "autopilot" });
      return { data: { origin, destination: t.destination, km, from, to, options: [], gaps: ["How to get there"] }, evidence: [], notes: [] };
    }
    try {
      const raw = await ctx.llm.json({
        tier: "default",
        schema: rawSchema,
        maxTokens: 1400,
        temperature: 0.1,
        timeoutMs: 25000,
        signal: ctx.signal,
        purpose: "travel",
        system: [
          `You compare the realistic ways to travel from ${origin} to ${t.destination}${km ? ` (${km} km in a straight line)` : ""}.`,
          "Use only the numbered sources. Include a mode ONLY if the sources show it exists on this route (a flight on a short road trip is almost never right; don't invent one). At most 4 options.",
          "For each: mode (flight|train|bus|car|ferry|other), a short title, the typical door-to-door or ride duration as the source says it, a price range in the currency the source uses (priceMin/priceMax per person, one way), a one-line practical note, and the source id (w1, w2…).",
          "Never guess a price. If no source gives one, set priceMin and priceMax to null. Mark exactly one option best: the one most travellers would choose for comfort and cost.",
          UNTRUSTED_WEB_RULE,
          languageRule(input),
          'Shape: {"options":[{"mode":"train","title":"…","duration":"…","priceMin":0,"priceMax":0,"currency":"USD","note":"…","source":"w2","best":true}]}',
        ].join("\n"),
        user: [`Route: ${origin} to ${t.destination}`, t.startDate ? `Travel date: ${t.startDate}` : "", "", quoteWeb(sources)].filter(Boolean).join("\n"),
      });
      const shaped = shapeTravel(rawSchema.parse(raw), sources);
      ctx.progress?.({ kind: "saw", id: "tr.find", tool: "travel", ok: shaped.options.length > 0, text: shaped.options.length ? `${shaped.options.length} ways to get there` : "No reliable options found", ms: Date.now() - t0, by: "autopilot" });
      return {
        data: { origin, destination: t.destination, km, from, to, options: shaped.options, gaps: shaped.options.length ? [] : ["How to get there"] },
        evidence: shaped.used.map((s) => webEvidence(s)),
        notes: [],
      };
    } catch (err) {
      ctx.log.warn("Trip travel research failed", { error: String(err) });
      return { data: { origin, destination: t.destination, km, from, to, options: [], gaps: ["How to get there"] }, evidence: [], notes: [] };
    }
  },
};
