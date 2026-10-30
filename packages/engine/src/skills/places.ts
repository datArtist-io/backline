// Finding places for a plan. Two sources, merged: Qloo (taste-aware, rated, priced) and
// OpenStreetMap (on-the-ground coverage, often with phone, email and website). Every result is
// checked against a real point on the map and scored for this person: distance, budget, rating
// and taste. Web research then fills in prices and booking contacts for the best few.
import { z } from "zod";
import type { QlooEntity } from "../clients/qloo";
import type { OsmKind, OsmPlace } from "../clients/osm";
import type { WebResult } from "../clients/web";
import type { HotelOffer } from "../clients/hotels";
import { EMAIL_RE } from "../clients/email";
import type { BriefInput, Evidence, SkillContext } from "../types";
import { UNTRUSTED_WEB_RULE, languageRule, quoteWeb, textOf, webEvidence } from "../grounding";
import { broadeningLadder, distanceKm } from "../location";
import { foldText, mapLimit, withTimeout } from "../util";
import { UpstreamError } from "../errors";

export type PlaceKind = OsmKind;
export const PLACE_KINDS = ["stay", "dine", "venue", "activity"] as const;

export const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  priceLevel: z.number().nullable(),
  rating: z.number().nullable(),
  affinity: z.number().nullable(),
  /** How well it fits the person's taste among the places Qloo returned, 0–1 (1 is the best fit). Set only when there's a taste to match. */
  match: z.number().nullable().optional(),
  image: z.string().nullable(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  tags: z.array(z.string()),
  fit: z.number(),
  why: z.array(z.string()),
  priceNote: z.string().nullable(),
  extra: z.string().nullable(),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  /** Straight-line distance from the landmark (or city centre) the user cares about. */
  distanceKm: z.number().nullable().optional(),
  kind: z.enum(PLACE_KINDS).nullable().optional(),
  /** Where it came from: "qloo", "osm", "qloo+osm", "hotels" (a live booking provider). */
  source: z.string().nullable().optional(),
  /** The nightly price listed online for the user's dates, with the page it's on. */
  rate: z.object({ perNight: z.number(), currency: z.string(), total: z.number().nullable(), url: z.string(), site: z.string(), note: z.string().nullable() }).nullable().optional(),
  /** A live, bookable rate for the user's dates, when a booking provider is connected. */
  offer: z
    .object({ offerId: z.string(), total: z.number(), currency: z.string(), perNight: z.number().nullable(), roomName: z.string().nullable(), board: z.string().nullable(), refundable: z.boolean().nullable(), cancellation: z.string().nullable(), provider: z.string(), /** A test-mode (sandbox) rate: bookable for a demo, never a real price. */ test: z.boolean().optional() })
    .nullable()
    .optional(),
});
export type Place = z.infer<typeof placeSchema>;

export type KindSpec = {
  label: string;
  plural: string;
  /** Keyword for Qloo's tag search. */
  qlooTag: string;
  /** Which Qloo tags count as this kind. */
  tagMatch: RegExp;
  /** Words in a name that suggest this kind, when no tag is usable. */
  nameWords: RegExp;
  /** Default search radius around a landmark, km. */
  nearKm: number;
  /** Default search radius around a city centre, km. */
  cityKm: number;
};

const LODGING_NAME = /\b(hotel|resort|lodge|inn|hostel|guest ?house|suites|villas?|apartments?|bungalows?|b&b|boutique hotel|intercontinental|ihg|hilton|marriott|sheraton|radisson|hyatt|novotel|ibis|four seasons|ritz[- ]carlton|westin|holiday inn|best western|pullman|sofitel|kempinski|m[oö]venpick|fairmont|sheraton|swiss[oô]tel|le m[eé]ridien)\b/i;
/** Names that are a hotel's restaurant or a real sight, kept even with "hotel" or "resort" in them. */
const NOT_JUST_LODGING = /\b(restaurant|grill|kitchen|bistro|caf[eé]|eatery|bar|dining|rooftop|museum|park|gallery|market|monument|tower|shrine|fort|tour|spice farm)\b/i;

export const KINDS: Record<PlaceKind, KindSpec> = {
  stay: { label: "hotel", plural: "hotels", qlooTag: "hotel", tagMatch: /hotel|lodging/i, nameWords: /hotel|suites|resort|inn\b|lodge|apartment|guest ?house|hostel/i, nearKm: 5, cityKm: 10 },
  dine: { label: "restaurant", plural: "restaurants", qlooTag: "restaurant", tagMatch: /restaurant|dining/i, nameWords: /restaurant|grill|kitchen|bistro|cafe|eatery|lounge|bar\b/i, nearKm: 2, cityKm: 8 },
  venue: { label: "venue", plural: "venues", qlooTag: "event venue", tagMatch: /event|venue|banquet|conference|hall/i, nameWords: /venue|hall|event|centre|center|garden|banquet|conference|club/i, nearKm: 5, cityKm: 15 },
  activity: { label: "place to visit", plural: "things to do", qlooTag: "tourist attraction", tagMatch: /attraction|museum|park|landmark|gallery/i, nameWords: /museum|park|gallery|beach|market|centre|center|tower|monument|shrine/i, nearKm: 5, cityKm: 15 },
};

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null;
const httpsUrl = (v: unknown): string | null => (typeof v === "string" && /^https?:\/\//i.test(v) ? v.replace(/^http:/i, "https:").slice(0, 300) : null);

/** A Qloo place entity → a Place. Pure. */
export function toPlace(e: QlooEntity, kind: PlaceKind | null = null): Place {
  const p = e.properties;
  return {
    id: e.id,
    name: e.name,
    address: textOf(p.address, 200),
    phone: typeof p.phone === "string" ? p.phone.slice(0, 40) : null,
    email: null,
    website: httpsUrl(p.website),
    priceLevel: num(p.price_level),
    rating: num(p.business_rating),
    affinity: e.affinity,
    image: e.image,
    lat: e.location?.lat ?? null,
    lon: e.location?.lon ?? null,
    tags: e.tags.map((t) => t.name).slice(0, 8),
    fit: 0,
    why: [],
    priceNote: null,
    extra: null,
    sources: [],
    kind,
    source: "qloo",
  };
}

/**
 * Taste match for Qloo results, from their rank by affinity. Qloo's raw affinities sit close
 * together, so rank is what tells places apart: the best fit is 1, the last about 0.5. Pure.
 */
export function withMatch(places: Place[]): Place[] {
  const ranked = [...places].filter((p) => p.affinity != null).sort((a, b) => b.affinity! - a.affinity!);
  const n = ranked.length;
  const rank = new Map(ranked.map((p, i) => [p.id, i]));
  return places.map((p) => (rank.has(p.id) ? { ...p, match: Math.round((1 - (0.5 * rank.get(p.id)!) / Math.max(1, n - 1)) * 100) / 100 } : p));
}

/** Hotel stars → a 1–4 price level, so budget fit works for map-only places. Pure. */
const starsToLevel = (stars: number) => (stars >= 5 ? 4 : stars >= 4 ? 3 : stars >= 3 ? 2 : 1);

/** An OpenStreetMap place → a Place. Pure. */
export function fromOsm(o: OsmPlace, kind: PlaceKind): Place {
  return {
    id: o.id,
    name: o.name,
    address: o.address,
    phone: o.phone,
    email: o.email,
    website: o.website,
    priceLevel: o.stars ? starsToLevel(o.stars) : null,
    rating: null,
    affinity: null,
    image: null,
    lat: o.lat,
    lon: o.lon,
    tags: o.tags.slice(0, 8),
    fit: 0,
    why: [],
    priceNote: null,
    extra: o.hours ? `Hours: ${o.hours}` : null,
    sources: [{ title: "OpenStreetMap", url: o.url }],
    kind,
    source: "osm",
  };
}

const NAME_NOISE = new Set(["the", "and", "of", "hotel", "hotels", "restaurant", "suites", "suite", "lounge", "bar", "cafe", "ltd", "limited", "plc", "lagos", "city", "by"]);
const nameTokens = (s: string) => foldText(s).split(" ").filter((t) => t.length > 1 && !NAME_NOISE.has(t));

/** Two listings with names this close are the same business. Pure. */
export function sameName(a: string, b: string): boolean {
  const fa = foldText(a);
  const fb = foldText(b);
  if (!fa || !fb) return false;
  if (fa === fb || (fa.length >= 5 && fb.includes(fa)) || (fb.length >= 5 && fa.includes(fb))) return true;
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / new Set([...ta, ...tb]).size >= 0.5;
}

/**
 * Merge two lists of the same kind of place. A match (same name, within 300 m) becomes one
 * place that keeps the first list's ratings and fills gaps (phone, email, website, address)
 * from the second. Pure.
 */
export function mergePlaces(primary: Place[], extra: Place[]): Place[] {
  const out = primary.map((p) => ({ ...p }));
  for (const o of extra) {
    const match = out.find(
      (p) => sameName(p.name, o.name) && (p.lat == null || p.lon == null || o.lat == null || o.lon == null || distanceKm({ lat: p.lat, lon: p.lon }, { lat: o.lat, lon: o.lon }) <= 0.3)
    );
    if (!match) {
      out.push({ ...o });
      continue;
    }
    match.phone = match.phone ?? o.phone;
    match.email = match.email ?? o.email;
    match.website = match.website ?? o.website;
    match.address = match.address ?? o.address;
    match.priceLevel = match.priceLevel ?? o.priceLevel;
    match.extra = match.extra ?? o.extra;
    match.lat = match.lat ?? o.lat;
    match.lon = match.lon ?? o.lon;
    match.tags = [...new Set([...match.tags, ...o.tags])].slice(0, 8);
    match.sources = [...match.sources, ...o.sources.filter((s) => !match.sources.some((x) => x.url === s.url))].slice(0, 4);
    match.source = match.source === o.source ? match.source : "qloo+osm";
  }
  return out;
}

/** Score a place for this person: distance, taste, rating, budget fit. Pure. */
export function scorePlace(p: Place, opts: { priceTier: number | null; dietary?: string[]; tasteBased: boolean; nearBonus?: boolean; query?: string | null; tasteLabel?: string }): Place {
  const why: string[] = [];
  let fit = 0;
  // When the user named a landmark, being close to it matters most.
  if (opts.nearBonus && p.distanceKm != null) {
    fit += Math.max(0, 1 - p.distanceKm / 8) * 0.4;
    why.push(p.distanceKm < 1 ? "Walking distance" : `${p.distanceKm} km away`);
  }
  const taste = opts.tasteBased ? (p.match ?? null) : p.affinity;
  if (taste != null) {
    fit += taste * (opts.nearBonus ? 0.2 : 0.45);
    if (opts.tasteBased && taste >= 0.75) why.push(opts.tasteLabel ?? "Matches your taste");
  } else fit += 0.2;
  if (p.rating != null) {
    fit += (Math.min(5, p.rating) / 5) * 0.3;
    if (p.rating >= 4.3) why.push(`Rated ${p.rating.toFixed(1)}`);
  }
  if (opts.priceTier && p.priceLevel) {
    const gap = Math.abs(p.priceLevel - opts.priceTier);
    fit += (1 - gap / 3) * 0.25;
    if (gap === 0) why.push("Fits your budget");
    else if (p.priceLevel > opts.priceTier) why.push("Above your budget");
  } else fit += 0.1;
  if (opts.dietary?.length) {
    const tags = p.tags.map(foldText).join(" ");
    const hit = opts.dietary.find((d) => tags.includes(foldText(d)));
    if (hit) {
      fit += 0.1;
      why.push(`${hit} options`);
    }
  }
  if (opts.query) {
    const words = foldText(opts.query).split(" ").filter((w) => w.length > 2);
    const hay = foldText(`${p.name} ${p.tags.join(" ")}`);
    if (words.length && words.some((w) => hay.includes(w))) fit += 0.1;
  }
  // Something the agent can actually contact or book is worth more.
  if (p.phone || p.email || p.website) fit += 0.05;
  if (p.offer) fit += 0.1;
  return { ...p, fit: Math.round(Math.min(1, fit) * 100) / 100, why };
}

const tagCache = new Map<string, string[]>();

/** Qloo tag ids for a kind of place ("hotel", "restaurant", "event venue"). Cached per process. */
export async function placeTags(ctx: SkillContext, query: string, mustInclude: RegExp): Promise<string[]> {
  const key = query.toLowerCase();
  if (tagCache.has(key)) return tagCache.get(key)!;
  let ids: string[] = [];
  try {
    const tags = await ctx.qloo.findTags(query, 10, ctx.signal);
    ctx.usage.add("qloo", 1);
    ids = tags
      .filter((t) => mustInclude.test(`${t.id} ${t.name}`) && /place|category|setting/i.test(`${t.id} ${t.type ?? ""}`))
      .slice(0, 2)
      .map((t) => t.id);
  } catch (err) {
    ctx.log.warn("Tag lookup failed", { query, error: String(err) });
    return []; // don't cache a failure
  }
  tagCache.set(key, ids);
  return ids;
}

export type Anchor = { name: string; lat: number; lon: number };

export type NearSearch = {
  kind: PlaceKind;
  anchor: Anchor;
  radiusKm: number;
  /** Qloo ids of things the person loves. */
  signals: string[];
  /** Qloo tag ids for genres or cuisines they love. */
  tagSignals?: string[];
  priceTier: number | null;
  dietary?: string[];
  /** Extra preference words, e.g. "rooftop", "Nigerian". Boosts matches; doesn't exclude. */
  query?: string | null;
  /** The anchor is a landmark the user wants to be close to (distance matters most). */
  nearBonus: boolean;
  take?: number;
  /** How a taste match is explained, e.g. "Loved by fans of Burna Boy". */
  tasteLabel?: string;
};

export type NearResult = { places: Place[]; counts: { qloo: number; osm: number; merged: number }; failures: string[] };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The most time one place source may take in a search. */
export const SOURCE_BUDGET_MS = 11000;

/** Places of one kind around a point, from Qloo and OpenStreetMap together, best first. */
export async function searchNear(ctx: SkillContext, s: NearSearch): Promise<NearResult> {
  const spec = KINDS[s.kind];
  const take = s.take ?? 12;
  const failures: string[] = [];

  const tasteOn = s.signals.length + (s.tagSignals?.length ?? 0) > 0;
  const qlooTask = (async (): Promise<Place[]> => {
    const tags = await placeTags(ctx, spec.qlooTag, spec.tagMatch);
    const raw = await ctx.qloo.insights(
      "urn:entity:place",
      { entityIds: s.signals.length ? s.signals : undefined, tagIds: s.tagSignals?.length ? s.tagSignals : undefined, near: { lat: s.anchor.lat, lon: s.anchor.lon, radiusKm: s.radiusKm }, filterTags: tags.length ? tags : undefined, take: 25 },
      ctx.signal
    );
    ctx.usage.add("qloo", 1);
    // Guard: the radius is enforced here too, and without a usable tag the name must say what it is.
    const found = raw
      .filter((e) => e.location && distanceKm(s.anchor, e.location) <= s.radiusKm * 1.25 && (tags.length > 0 || spec.nameWords.test(`${e.tags.map((t) => t.name).join(" ")} ${e.name}`)))
      .map((e) => toPlace(e, s.kind));
    return tasteOn ? withMatch(found) : found;
  })();

  const osmTask = (async (): Promise<Place[]> => {
    if (!ctx.osm) return [];
    const found = await ctx.osm.nearby(s.kind, s.anchor, s.radiusKm * 1000, { signal: ctx.signal, budgetMs: SOURCE_BUDGET_MS - 1000 });
    ctx.usage.add("maps", 1);
    return found.map((o) => fromOsm(o, s.kind));
  })();

  // Each source has a fixed budget, so one slow service can't hold the agent up.
  const [q, o] = await Promise.allSettled([withTimeout(qlooTask, SOURCE_BUDGET_MS, "Qloo places"), withTimeout(osmTask, SOURCE_BUDGET_MS, "Map places")]);
  const qPlaces = q.status === "fulfilled" ? q.value : [];
  const oPlaces = o.status === "fulfilled" ? o.value : [];
  if (q.status === "rejected") failures.push("Qloo");
  if (o.status === "rejected") failures.push("OpenStreetMap");
  if (q.status === "rejected") ctx.log.warn("Qloo place search failed", { kind: s.kind, error: String(q.reason) });
  if (o.status === "rejected") ctx.log.warn("Map place search failed", { kind: s.kind, error: String(o.reason) });

  const merged = mergePlaces(qPlaces, oPlaces);
  const places = merged
    .map((p) => ({ ...p, distanceKm: p.lat != null && p.lon != null ? round1(distanceKm(s.anchor, { lat: p.lat, lon: p.lon })) : null }))
    .filter((p) => p.distanceKm == null || p.distanceKm <= s.radiusKm * 1.25)
    // A hotel or resort isn't a restaurant or a thing to do (Qloo and the map tag many of them as both).
    .filter((p) => s.kind === "stay" || s.kind === "venue" || !LODGING_NAME.test(p.name) || NOT_JUST_LODGING.test(p.name))
    .map((p) => scorePlace(p, { priceTier: s.priceTier, dietary: s.kind === "dine" ? s.dietary : undefined, tasteBased: s.signals.length + (s.tagSignals?.length ?? 0) > 0, nearBonus: s.nearBonus, query: s.query, tasteLabel: s.tasteLabel }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, take);
  const both = merged.filter((p) => p.source === "qloo+osm").length;
  return { places, counts: { qloo: qPlaces.length, osm: oPlaces.length, merged: both }, failures };
}

/** A live, bookable hotel offer as a place. Pure. */
export function fromOffer(o: HotelOffer, provider: string, test = false): Place {
  return {
    id: `hotels:${o.hotelId}`,
    name: o.name,
    address: o.address,
    phone: null,
    email: null,
    website: null,
    priceLevel: o.stars ? (o.stars >= 5 ? 4 : o.stars >= 4 ? 3 : o.stars >= 3 ? 2 : 1) : null,
    rating: o.rating != null ? (o.rating > 5 ? Math.round((o.rating / 2) * 10) / 10 : o.rating) : null,
    affinity: null,
    image: o.image,
    lat: o.lat,
    lon: o.lon,
    tags: ["Hotel"],
    fit: 0,
    why: [],
    priceNote: null,
    extra: null,
    sources: [],
    kind: "stay",
    source: "hotels",
    offer: { offerId: o.offerId, total: o.total, currency: o.currency, perNight: o.perNight, roomName: o.roomName, board: o.board, refundable: o.refundable, cancellation: o.cancellation, provider, ...(test ? { test: true } : {}) },
  };
}

/**
 * Join live offers onto the hotels already found: the same hotel (by name, within 300 m) gets the
 * bookable rate; hotels only the booking provider knows are added. Pure.
 */
export function attachOffers(places: Place[], offers: HotelOffer[], provider: string, test = false): Place[] {
  const out = places.map((p) => ({ ...p }));
  for (const o of offers) {
    const match = out.find((p) => sameName(p.name, o.name) && (p.lat == null || p.lon == null || o.lat == null || o.lon == null || distanceKm({ lat: p.lat, lon: p.lon }, { lat: o.lat, lon: o.lon }) <= 0.3));
    const offer = fromOffer(o, provider, test).offer;
    if (match) {
      match.offer = offer;
      match.image = match.image ?? o.image;
    } else out.push(fromOffer(o, provider, test));
  }
  return out;
}

/**
 * Places of one kind by place name only (when nothing could be pinned on the map): Qloo's
 * location filter, broadening "Ikeja, Lagos, Nigeria" → "Lagos, Nigeria" → "Nigeria".
 */
export async function searchByName(ctx: SkillContext, kind: PlaceKind, location: string, taste: { entities: string[]; tags: string[] }, priceTier: number | null, take = 12): Promise<Place[]> {
  const spec = KINDS[kind];
  const tags = await placeTags(ctx, spec.qlooTag, spec.tagMatch);
  for (const q of broadeningLadder(location).slice(0, 2)) {
    const raw = await ctx.qloo.insights("urn:entity:place", { entityIds: taste.entities.length ? taste.entities : undefined, tagIds: taste.tags.length ? taste.tags : undefined, filterLocation: q, filterTags: tags.length ? tags : undefined, take: 20 }, ctx.signal).catch(() => [] as QlooEntity[]);
    ctx.usage.add("qloo", 1);
    const items = raw.filter((e) => tags.length > 0 || spec.nameWords.test(`${e.tags.map((t) => t.name).join(" ")} ${e.name}`));
    const tasteOn = taste.entities.length + taste.tags.length > 0;
    const places = items.map((e) => toPlace(e, kind));
    if (items.length) return (tasteOn ? withMatch(places) : places).map((p) => scorePlace(p, { priceTier, tasteBased: tasteOn })).sort((a, b) => b.fit - a.fit).slice(0, take);
  }
  return [];
}

const checkSchema = z.object({
  items: z.array(
    z.object({
      ref: z.string(),
      priceNote: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
      extra: z.string().nullable().optional(),
      sources: z.array(z.string()).default([]),
    })
  ),
});

/** What a booking check looks for, per kind of place. */
export function lookFor(kind: PlaceKind, t: { startDate: string | null; adults: number; event: { type: string; guests: number | null } | null }): string {
  if (kind === "stay") return `hotel nightly room rates${t.startDate ? ` around ${t.startDate}` : ""}`;
  if (kind === "dine") return `restaurant reservations for ${t.event?.guests ?? t.adults} people`;
  if (kind === "venue") return `${t.event?.type ?? "event"} venue hire for ${t.event?.guests ?? "a group of"} guests, capacity and price`;
  return "opening hours and ticket prices";
}

/**
 * Look up prices and booking contacts on the web for a few places. Contacts are kept only if the
 * exact email or the phone's digits appear in the cited source text, so the model can't invent one.
 * Returns the places (same order) with what was found filled in.
 */
export async function checkPlaces(ctx: SkillContext, input: BriefInput, places: Place[], city: string, what: (p: Place) => string, evidence: Evidence[]): Promise<Place[]> {
  if (!ctx.web || places.length === 0) return places;
  const top = places.slice(0, 4);
  let failure: unknown = null;
  const found = await mapLimit(top, 4, async (p) => {
    try {
      const r = await ctx.web!.search(`${p.name}, ${city}: ${what(p)}. Price range or rates, reservation or booking email, phone number, official website.`, { maxResults: 4, signal: ctx.signal, need: "booking" });
      ctx.usage.add("web", 1);
      return r;
    } catch (err) {
      failure = err;
      return [] as WebResult[];
    }
  });
  // Every lookup failed because the provider won't answer (no quota, bad key): say so instead of "no prices found".
  if (failure instanceof UpstreamError && [401, 403, 404, 429].includes(failure.status ?? 0) && found.every((r) => r.length === 0)) throw failure;
  const all: WebResult[] = [];
  const blocks = top.map((p, i) => {
    const start = all.length + 1;
    all.push(...found[i]);
    return `Place ${p.id} (${p.name}):\n${quoteWeb(found[i], start)}`;
  });
  if (all.length === 0 || !ctx.llm) return places;
  const byRef = new Map(all.map((r, i) => [`w${i + 1}`, r]));
  try {
    const out = await ctx.llm.json({
      tier: "fast",
      schema: checkSchema,
      maxTokens: 1000,
      temperature: 0,
      timeoutMs: 20000,
      signal: ctx.signal,
      system: [
        "Extract booking facts for each place from the sources.",
        UNTRUSTED_WEB_RULE,
        "For each place id: priceNote (a short price or rate range with currency, as stated), email (a reservations or contact email copied exactly), phone (copied exactly), website (the official website URL if a source shows it), extra (capacity or one useful booking detail). Use null when the sources don't say. sources: the source ids used.",
        "Never guess an email, phone number or price.",
        languageRule(input),
        'Shape: {"items":[{"ref":"<place id>","priceNote":null,"email":null,"phone":null,"website":null,"extra":null,"sources":["w1"]}]}',
      ].join("\n"),
      user: blocks.join("\n\n"),
    });
    return places.map((p) => {
      const it = out.items.find((x) => x.ref === p.id);
      if (!it) return p;
      const srcs = (it.sources ?? []).map((s) => byRef.get(s)).filter((r): r is WebResult => Boolean(r));
      if (srcs.length === 0) return p;
      const text = srcs.map((r) => `${r.content} ${r.url}`).join(" ");
      const digits = (s: string) => s.replace(/\D/g, "");
      const email = it.email && EMAIL_RE.test(it.email.trim()) && text.toLowerCase().includes(it.email.trim().toLowerCase()) ? it.email.trim() : null;
      const phone = it.phone && digits(it.phone).length >= 7 && digits(text).includes(digits(it.phone)) ? it.phone.trim() : null;
      const site = httpsUrl(it.website);
      const host = site ? hostOf(site) : null;
      const website = site && host && text.toLowerCase().includes(host) ? site : null;
      for (const r of srcs) evidence.push(webEvidence(r));
      return {
        ...p,
        email: p.email ?? email,
        phone: p.phone ?? phone,
        website: p.website ?? website,
        priceNote: it.priceNote?.slice(0, 120) ?? p.priceNote,
        extra: it.extra?.slice(0, 160) ?? p.extra,
        sources: [...p.sources, ...srcs.map((r) => ({ title: r.title, url: r.url }))].filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i).slice(0, 4),
      };
    });
  } catch (err) {
    ctx.log.warn("Place check failed", { error: String(err) });
    return places;
  }
}

export function placeEvidence(places: Place[], query: string): Evidence[] {
  return places.flatMap((p): Evidence[] =>
    p.source === "qloo" || p.source === "qloo+osm" || p.source == null ? [{ source: "qloo", entityId: p.id, label: p.name, affinity: p.affinity ?? undefined, query }] : []
  );
}
