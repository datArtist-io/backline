// The person's taste, read through Qloo before anything is searched. Names from the request, saved
// likes and a favourite celebrity become Qloo signals; from those signals Qloo returns the vibes,
// scenes and dishes that go with the taste, the age group it skews to, what fans of it also love,
// and where in the destination city that taste is concentrated (a heatmap). Every later step
// searches and scores places with these signals.
import { z } from "zod";
import type { DemographicsRow, HeatPoint, QlooEntity, QlooTag } from "../clients/qloo";
import type { BriefInput, Skill } from "../types";
import { distanceKm } from "../location";
import { withTimeout } from "../util";

/** Each lookup gets a fixed budget, so one slow answer can't hold up the plan; a missing part is simply left out. */
const PART_MS = 8000;
const part = <T>(p: Promise<T>, empty: T, label: string) => withTimeout(p, PART_MS, label).catch(() => empty);

export const tasteSignalSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  image: z.string().nullable().optional(),
  /** Where it came from: a celebrity to plan like, the request, saved likes, or (with no taste given) the destination itself. */
  from: z.enum(["star", "request", "saved", "place"]).optional(),
});

const pickSchema = z.object({ id: z.string(), name: z.string(), type: z.string().nullable(), image: z.string().nullable() });

export const tasteZoneSchema = z.object({ name: z.string().nullable(), lat: z.number(), lon: z.number(), radiusKm: z.number(), points: z.number() });
export type TasteZone = z.infer<typeof tasteZoneSchema>;

export const tasteOutput = z.object({
  /** Qloo entities the taste is read from. */
  signals: z.array(tasteSignalSchema),
  /** Qloo tags the taste is read from (genres, cuisines). */
  tags: z.array(z.object({ id: z.string(), name: z.string() })),
  vibes: z.array(z.string()),
  scenes: z.array(z.string()),
  dishes: z.array(z.string()),
  /** Qloo's read of the price level this taste goes for, 1–4. */
  priceLean: z.number().nullable(),
  /** "25–34", the age group the taste leans to most. */
  audience: z.string().nullable(),
  alsoLoved: z.array(pickSchema),
  /** The part of the city where the taste is strongest. */
  zone: tasteZoneSchema.nullable(),
  /** Heatmap points for the map, strongest first: [lat, lon, weight 0–1]. */
  heat: z.array(z.tuple([z.number(), z.number(), z.number()])),
});
export type TasteOutput = z.infer<typeof tasteOutput>;

const EMPTY: TasteOutput = { signals: [], tags: [], vibes: [], scenes: [], dishes: [], priceLean: null, audience: null, alsoLoved: [], zone: null, heat: [] };

// ---------- pure helpers ----------

const GENERIC_SCENES = /^(hotel|restaurant|lodging|point of interest|establishment|store)$/i;
/** Style tags that describe films or songs rather than a place. */
const MEDIA_STYLE = /-like$|catchy|contextual|silky|cinematic|melodic|lyrical|narrative|plot|docu/i;

/** Vibes, scenes, dishes and price lean from Qloo tag insights. Pure. */
export function readTags(tags: QlooTag[]): Pick<TasteOutput, "vibes" | "scenes" | "dishes" | "priceLean"> {
  const of = (type: string) => tags.filter((t) => t.type === type).map((t) => t.name.trim());
  const uniq = (xs: string[]) => [...new Set(xs)];
  const vibes = uniq(of("urn:tag:style:qloo").filter((n) => !MEDIA_STYLE.test(n))).slice(0, 4);
  const scenes = uniq(of("urn:tag:genre:place").filter((n) => !GENERIC_SCENES.test(n))).slice(0, 5);
  const dishes = uniq(of("urn:tag:specialty_dish:place")).slice(0, 4);
  const cost = of("urn:tag:cost_description:place")[0]?.toLowerCase() ?? "";
  const priceLean = !cost ? null : /very expensive/.test(cost) ? 4 : /moderately/.test(cost) ? 3 : /expensive/.test(cost) ? 4 : /inexpensive|cheap/.test(cost) ? 1 : 2;
  return { vibes, scenes, dishes, priceLean };
}

const AGE_LABEL: Record<string, string> = {
  "24_and_younger": "under 25",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55+",
};

/** The age group a taste leans to most, joining neighbours that lean almost as much ("25–34"). Pure. */
export function ageLean(rows: DemographicsRow[]): string | null {
  const age = rows[0]?.age;
  if (!age) return null;
  const order = Object.keys(AGE_LABEL);
  const vals = order.map((k) => age[k] ?? -1);
  const top = Math.max(...vals);
  if (top <= 0.05) return null;
  const i = vals.indexOf(top);
  // A neighbouring band within 0.1 of the top one widens the range.
  const j = [i - 1, i + 1].find((n) => n >= 0 && n < order.length && vals[n] >= top - 0.1);
  if (j == null) return AGE_LABEL[order[i]];
  const [lo, hi] = [Math.min(i, j), Math.max(i, j)];
  const from = AGE_LABEL[order[lo]].split("–")[0].replace("under 25", "18");
  const to = AGE_LABEL[order[hi]].split("–").pop()!.replace("+", "");
  return order[hi] === "55_and_older" ? `${from}+` : `${from}–${to}`;
}

/** How much a heatmap point counts: strong affinity in a part of town people actually go to. Pure. */
const weight = (p: HeatPoint) => p.affinity * (0.35 + 0.65 * (p.popularity ?? 0.5));

/**
 * The densest cluster of strong heatmap points: the part of town where the taste lives. Looks at
 * the strongest points, counts the weight of neighbours within `radiusKm` of each, and returns the
 * weighted centre of the best neighbourhood. Pure.
 */
export function tasteZone(points: HeatPoint[], radiusKm = 2): Omit<TasteZone, "name"> | null {
  const top = [...points].sort((a, b) => weight(b) - weight(a)).slice(0, 60);
  if (top.length < 3) return null;
  let best: { lat: number; lon: number; score: number; n: number } | null = null;
  for (const c of top) {
    const near = top.filter((p) => distanceKm(c, p) <= radiusKm);
    const score = near.reduce((s, p) => s + weight(p), 0);
    if (!best || score > best.score) {
      const w = near.reduce((s, p) => s + weight(p), 0);
      best = {
        lat: near.reduce((s, p) => s + p.lat * weight(p), 0) / w,
        lon: near.reduce((s, p) => s + p.lon * weight(p), 0) / w,
        score,
        n: near.length,
      };
    }
  }
  if (!best || best.n < 3) return null;
  return { lat: Math.round(best.lat * 1e5) / 1e5, lon: Math.round(best.lon * 1e5) / 1e5, radiusKm, points: best.n };
}

/** Heatmap points for drawing, strongest first, weights scaled 0–1. Pure. */
export function heatForMap(points: HeatPoint[], max = 220): [number, number, number][] {
  const sorted = [...points].sort((a, b) => weight(b) - weight(a)).slice(0, max);
  const hi = sorted[0] ? weight(sorted[0]) : 1;
  const lo = sorted.length ? weight(sorted[sorted.length - 1]) : 0;
  return sorted.map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5, Math.round(((weight(p) - lo) / (hi - lo || 1)) * 100) / 100]);
}

/** Entity types worth using as a taste signal. Localities and stray streets aren't tastes. */
const TASTE_TYPES = /artist|person|movie|tv_show|book|brand|place|podcast|video_game|destination/;

/** The first search hit that is a real taste (not a town or street), or null. Pure. */
export function tasteHit(hits: QlooEntity[]): QlooEntity | null {
  return hits.find((h) => h.type && TASTE_TYPES.test(h.type)) ?? null;
}

/** Tag types that read as a taste when a like is a genre or cuisine rather than a name. */
const LIKE_TAG_TYPES = /genre:music|genre:place|specialty_dish|genre:media|keyword:qloo/;

/**
 * Whether a like is a genre or cuisine (a Qloo tag) or a named thing (an entity). Written in lower
 * case with a tag of exactly that name ("jazz", "suya"), it's the genre; otherwise the named thing
 * wins, and a tag is the fallback when Qloo knows no such name. Pure.
 */
export function readLike(like: string, hits: QlooEntity[], tags: QlooTag[]): { entity: QlooEntity } | { tag: QlooTag } | null {
  const usable = tags.filter((t) => LIKE_TAG_TYPES.test(`${t.id} ${t.type ?? ""}`));
  const same = usable.find((t) => t.name.trim().toLowerCase() === like.trim().toLowerCase());
  if (same && like === like.toLowerCase()) return { tag: same };
  // A named thing only counts when the like appears in its name as whole words: "suya" must not
  // become "Suyash Restaurant", but "wizkid" is Wizkid and "the weeknd" is The Weeknd.
  const words = (x: string) => ` ${x.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  // A generic like in lower case ("historical sites", "nature") must match a name exactly: it once became
  // "Truong Bon historical sites" in Vietnam. A proper name ("Burna Boy", "Wizkid") may sit inside a longer one.
  const generic = like === like.toLowerCase() && !/\d/.test(like);
  const hit = tasteHit(hits.filter((h) => words(h.name) === words(like) || words(like).includes(words(h.name)) || (!generic && words(h.name).includes(words(like)))));
  if (hit) return { entity: hit };
  const tag = same ?? usable[0];
  return tag ? { tag } : null;
}

// ---------- the skill ----------

export const tripTaste: Skill<BriefInput, TasteOutput> = {
  id: "trip.taste",
  title: "Reading your taste",
  dependsOn: [],
  timeoutMs: 30_000,
  output: tasteOutput,
  async run(ctx, input) {
    const star = input.trip?.inspiredBy?.trim() || null;
    const said = (input.trip?.likes ?? []).map((l) => l.trim()).filter(Boolean);
    const saved = (input.profile?.likes ?? []).map((l) => l.trim()).filter(Boolean);
    // What they asked for this time leads; saved likes only fill in when the request names none,
    // so "afrobeats and suya" isn't read as "Drake" from an older trip.
    // A star to plan like is taste enough: older saved likes never get mixed into "the way X would".
    const likes = (said.length ? said.map((name) => ({ name, from: "request" as const })) : star ? [] : saved.map((name) => ({ name, from: "saved" as const }))).slice(0, 6);
    const city = input.trip?.destination?.trim() || "";
    // No taste given: read the destination through Qloo instead — what people who love this place
    // go for — so the trip is still tuned by taste data, and say so.
    let placeHit: QlooEntity | null = null;
    if (likes.length === 0 && !star) {
      placeHit = city ? ((await ctx.qloo.search(city, { types: ["urn:entity:destination"], take: 1, signal: ctx.signal }).catch(() => [] as QlooEntity[]))[0] ?? null) : null;
      ctx.usage.add("qloo", city ? 1 : 0);
      if (!placeHit)
        return {
          data: EMPTY,
          evidence: [],
          notes: ["No taste to go on yet, so picks lean on distance, ratings and budget. Mention what you love (an artist, a film, a cuisine) or plan it like a favourite star would."],
        };
    }

    // Names first: each like becomes a Qloo entity (an artist, film, place) or a tag (a genre, a cuisine).
    const [starHits, ...found] = await Promise.all([
      star ? ctx.qloo.search(star, { types: ["urn:entity:artist", "urn:entity:person"], take: 1, signal: ctx.signal }).catch(() => [] as QlooEntity[]) : Promise.resolve([] as QlooEntity[]),
      ...likes.map((l) =>
        Promise.all([ctx.qloo.search(l.name, { take: 3, signal: ctx.signal }).catch(() => [] as QlooEntity[]), ctx.qloo.findTags(l.name, 5, ctx.signal).catch(() => [] as QlooTag[])])
      ),
    ]);
    ctx.usage.add("qloo", likes.length * 2 + (star ? 1 : 0));
    const signals: TasteOutput["signals"] = [];
    const tags: TasteOutput["tags"] = [];
    if (placeHit) signals.push({ id: placeHit.id, name: placeHit.name, type: placeHit.type, image: placeHit.image, from: "place" });
    if (starHits[0]) signals.push({ id: starHits[0].id, name: starHits[0].name, type: starHits[0].type, image: starHits[0].image, from: "star" });
    likes.forEach((l, i) => {
      const read = readLike(l.name, found[i][0], found[i][1]);
      if (!read) return;
      if ("entity" in read) {
        const e = read.entity;
        if (!signals.some((s) => s.id === e.id)) signals.push({ id: e.id, name: e.name, type: e.type, image: e.image, from: l.from });
      } else if (!tags.some((t) => t.id === read.tag.id)) tags.push({ id: read.tag.id, name: read.tag.name });
    });
    const ids = signals.slice(0, 6).map((s) => s.id);
    const tagIds = tags.map((t) => t.id);
    if (ids.length === 0 && tagIds.length === 0) {
      const who = star ?? likes[0]?.name;
      return { data: EMPTY, evidence: [], notes: [`I couldn't find ${who} in Qloo's taste data, so picks lean on distance, ratings and budget.`] };
    }

    // Then everything Qloo can say about that taste, in parallel.
    const q = { tagIds };
    const [tagRows, demo, artists, brands, heat] = await Promise.all([
      part(ctx.qloo.tagInsights(ids, 40, ctx.signal, { ...q, tagTypes: ["urn:tag:style:qloo", "urn:tag:genre:place", "urn:tag:specialty_dish:place", "urn:tag:cost_description:place"] }), [] as QlooTag[], "Taste themes"),
      part(ctx.qloo.demographics(ids, ctx.signal, q), [] as DemographicsRow[], "Taste audience"),
      part(ctx.qloo.insights("urn:entity:artist", { entityIds: ids.length ? ids : undefined, tagIds, take: 8 }, ctx.signal), [] as QlooEntity[], "Also loved"),
      part(ctx.qloo.insights("urn:entity:brand", { entityIds: ids.length ? ids : undefined, tagIds, take: 4 }, ctx.signal), [] as QlooEntity[], "Also loved brands"),
      city ? part(ctx.qloo.heatmap(ids, city, ctx.signal, q), [] as HeatPoint[], "Taste heatmap") : Promise.resolve([] as HeatPoint[]),
    ]);
    ctx.usage.add("qloo", city ? 5 : 4);

    // Leave out the tastes themselves (Qloo can list an artist under a second id).
    const known = new Set(signals.flatMap((s) => [s.id, s.name.toLowerCase()]));
    const alsoLoved = [...artists.filter((a) => !known.has(a.id) && !known.has(a.name.toLowerCase())).slice(0, 4), ...brands.slice(0, 2)].map((e) => ({ id: e.id, name: e.name, type: e.type, image: e.image }));
    const spot = tasteZone(heat);
    let zone: TasteZone | null = null;
    if (spot) {
      const name = ctx.osm ? await withTimeout(ctx.osm.reverse(spot, ctx.signal), 5000, "Naming the area").catch(() => null) : null;
      zone = { ...spot, name };
    }

    const data: TasteOutput = { signals, tags, ...readTags(tagRows), audience: ageLean(demo), alsoLoved, zone, heat: heatForMap(heat) };
    const label = placeHit ? `what people who love ${placeHit.name} go for` : star && signals[0]?.from === "star" ? `places fans of ${signals[0].name} love` : "your taste";
    const notes = placeHit
      ? [`You didn't say what you love, so I read ${placeHit.name} through Qloo: what people who love it go for. Tell me an artist, film or cuisine you love to tune it to you.`]
      : star && !starHits[0] ? [`I couldn't find ${star} in the taste data, so picks follow the rest of your taste.`] : [];
    return {
      data,
      evidence: [
        ...signals.map((s) => ({ source: "qloo" as const, entityId: s.id, label: s.name, query: label })),
        ...(zone ? [{ source: "qloo" as const, entityId: ids[0] ?? tagIds[0], label: `Taste heatmap: strongest around ${zone.name ?? "this area"}`, query: `heatmap of ${label} in ${city}` }] : []),
      ],
      notes,
    };
  },
};
