import { z } from "zod";
import type { QlooEntity } from "../clients/qloo";
import type { BriefInput, Evidence, Skill } from "../types";
import { FactSheet, GROUNDING_RULES, artistFrom, languageRule, textOf } from "../grounding";
import { broadeningLadder, distanceKm, findPlaces, normalizeLocation } from "../location";
import { EngineError } from "../errors";
import { mapLimit } from "../util";
import type { FansDnaOutput } from "./fans-dna";

export const VENUE_TAG = "urn:tag:setting:qloo:music_venue";
const CITY_MAX = 10;
const DEFAULT_STOPS = 5;
const STOP_MAX = 8;

// ---------- tour.cities ----------

const city = z.object({ id: z.string(), name: z.string(), affinity: z.number().nullable(), lat: z.number().nullable(), lon: z.number().nullable(), image: z.string().nullable() });
export const tourCitiesOutput = z.object({ region: z.string().nullable(), searched: z.string(), cities: z.array(city) });
export type TourCitiesOutput = z.infer<typeof tourCitiesOutput>;
export type TourCity = z.infer<typeof city>;

const toCity = (e: QlooEntity): TourCity => ({ id: e.id, name: e.name, affinity: e.affinity, lat: e.location?.lat ?? null, lon: e.location?.lon ?? null, image: e.image });

export const tourCities: Skill<BriefInput, TourCitiesOutput> = {
  id: "tour.cities",
  title: "Finding where the taste is strongest",
  dependsOn: ["artist.resolve"],
  timeoutMs: 30_000,
  output: tourCitiesOutput,
  async run(ctx, input, deps) {
    const artist = artistFrom(deps);
    const region = normalizeLocation(input.location);
    const notes: string[] = [];
    let found: QlooEntity[] = [];
    let searched = "worldwide";

    if (region) {
      for (const q of broadeningLadder(region)) {
        found = await ctx.qloo.insights("urn:entity:destination", { entityIds: [artist.id], filterLocation: q, take: CITY_MAX + 5 }, ctx.signal);
        ctx.usage.add("qloo", 1);
        if (found.length > 0) {
          searched = q;
          if (q !== region) notes.push(`Not enough data for ${region}, so this covers ${q}.`);
          break;
        }
      }
      if (found.length === 0) notes.push(`No destination data for ${region}, so this covers the world.`);
    }
    if (found.length === 0) {
      found = await ctx.qloo.insights("urn:entity:destination", { entityIds: [artist.id], take: CITY_MAX + 5 }, ctx.signal);
      ctx.usage.add("qloo", 1);
    }
    const cities = found.filter((e) => e.id !== artist.id).slice(0, CITY_MAX).map(toCity);
    if (cities.length === 0) throw new EngineError("No cities", `There isn't enough location data for ${artist.name}'s fans yet.`);
    notes.push("Ranked by how strongly this fanbase's taste over-indexes in each place.");
    const evidence: Evidence[] = cities.map((c) => ({ source: "qloo", entityId: c.id, label: c.name, affinity: c.affinity ?? undefined, query: `destinations · fans of ${artist.name} · ${searched}` }));
    return { data: { region, searched, cities }, evidence, notes };
  },
};

/** The cities a tour covers: the user's picks if any, otherwise the top ones. */
export function tourStops(cities: TourCity[], selected?: string[]): TourCity[] {
  if (selected && selected.length > 0) {
    const picked = selected.map((id) => cities.find((c) => c.id === id)).filter((c): c is TourCity => Boolean(c));
    if (picked.length > 0) return picked.slice(0, STOP_MAX);
  }
  return cities.slice(0, DEFAULT_STOPS);
}

// ---------- tour.venues ----------

const venue = z.object({ id: z.string(), name: z.string(), address: z.string().nullable(), affinity: z.number().nullable(), lat: z.number().nullable(), lon: z.number().nullable(), website: z.string().nullable() });
export const tourVenuesOutput = z.object({
  stops: z.array(z.object({ cityId: z.string(), city: z.string(), searched: z.string(), coverage: z.enum(["exact", "broadened", "nearby", "none"]), venues: z.array(venue) })),
});
export type TourVenuesOutput = z.infer<typeof tourVenuesOutput>;

const safeUrl = (v: unknown): string | null => (typeof v === "string" && /^https:\/\//i.test(v) ? v.slice(0, 300) : null);

export const tourVenues: Skill<BriefInput, TourVenuesOutput> = {
  id: "tour.venues",
  title: "Shortlisting venues in each city",
  dependsOn: ["artist.resolve", "tour.cities"],
  timeoutMs: 60_000,
  output: tourVenuesOutput,
  async run(ctx, input, deps) {
    const artist = artistFrom(deps);
    const { cities } = deps["tour.cities"].data as TourCitiesOutput;
    const stops = tourStops(cities, input.selections?.cities);
    const evidence: Evidence[] = [];
    const out = await mapLimit(stops, 3, async (c) => {
      try {
        const res = await findPlaces(ctx, [artist.id], c.name, { filterTags: [VENUE_TAG], take: 6 });
        const venues = res.items.map((p) => ({
          id: p.id,
          name: p.name,
          address: textOf(p.properties.address, 160),
          affinity: p.affinity,
          lat: p.location?.lat ?? null,
          lon: p.location?.lon ?? null,
          website: safeUrl(p.properties.website),
        }));
        for (const v of venues) evidence.push({ source: "qloo", entityId: v.id, label: v.name, affinity: v.affinity ?? undefined, query: `music venues · fans of ${artist.name} · ${res.searched}` });
        return { cityId: c.id, city: c.name, searched: res.searched, coverage: res.coverage, venues };
      } catch (err) {
        ctx.log.warn("Venue search failed", { city: c.name, error: String(err) });
        return { cityId: c.id, city: c.name, searched: c.name, coverage: "none" as const, venues: [] };
      }
    });
    const notes = out.filter((s) => s.venues.length === 0).map((s) => `No venue data for ${s.city} yet.`);
    return { data: { stops: out }, evidence, notes };
  },
};

// ---------- tour.route ----------

export const tourRouteOutput = z.object({
  legs: z.array(z.object({ order: z.number(), cityId: z.string(), city: z.string(), headliner: z.string().nullable(), kmFromPrevious: z.number().nullable() })),
  totalKm: z.number(),
  unplaced: z.array(z.string()),
});
export type TourRouteOutput = z.infer<typeof tourRouteOutput>;

/** Order stops by nearest neighbour, starting from the strongest city. Pure. */
export function planRoute(stops: TourCity[]): { order: TourCity[]; km: (number | null)[]; unplaced: TourCity[] } {
  const placed = stops.filter((s) => s.lat != null && s.lon != null);
  const unplaced = stops.filter((s) => s.lat == null || s.lon == null);
  if (placed.length === 0) return { order: [], km: [], unplaced };
  const start = [...placed].sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))[0];
  const order = [start];
  const km: (number | null)[] = [null];
  const left = placed.filter((s) => s !== start);
  while (left.length > 0) {
    const cur = order[order.length - 1];
    let best = 0;
    let bestD = Infinity;
    left.forEach((s, i) => {
      const d = distanceKm({ lat: cur.lat!, lon: cur.lon! }, { lat: s.lat!, lon: s.lon! });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    order.push(left.splice(best, 1)[0]);
    km.push(Math.round(bestD));
  }
  return { order, km, unplaced };
}

export const tourRoute: Skill<BriefInput, TourRouteOutput> = {
  id: "tour.route",
  title: "Routing the tour",
  dependsOn: ["tour.cities"],
  optionalDeps: ["tour.venues"],
  timeoutMs: 5_000,
  output: tourRouteOutput,
  async run(_ctx, input, deps) {
    const { cities } = deps["tour.cities"].data as TourCitiesOutput;
    const venues = deps["tour.venues"]?.data as TourVenuesOutput | undefined;
    const stops = tourStops(cities, input.selections?.cities);
    const { order, km, unplaced } = planRoute(stops);
    const legs = order.map((c, i) => {
      const v = venues?.stops.find((s) => s.cityId === c.id)?.venues[0];
      return { order: i + 1, cityId: c.id, city: c.name, headliner: v?.name ?? null, kmFromPrevious: km[i] };
    });
    const totalKm = km.reduce<number>((s, d) => s + (d ?? 0), 0);
    const evidence: Evidence[] = [{ source: "derived", label: `Route across ${legs.length} cities, about ${totalKm.toLocaleString("en")} km`, basis: "Nearest-neighbour order from the strongest city, straight-line distances" }];
    const notes = unplaced.length ? [`No coordinates for ${unplaced.map((u) => u.name).join(", ")}, so they're listed separately.`] : [];
    return { data: { legs, totalKm, unplaced: unplaced.map((u) => u.name) }, evidence, notes };
  },
};

// ---------- tour.experiences ----------

export const tourExperiencesOutput = z.object({
  ideas: z.array(z.object({ title: z.string(), city: z.string().nullable(), description: z.string(), sources: z.array(z.string()) })),
  facts: z.array(z.object({ id: z.string(), text: z.string() })),
  method: z.enum(["model", "template"]),
});
export type TourExperiencesOutput = z.infer<typeof tourExperiencesOutput>;

const experiencesModel = z.object({
  ideas: z.array(z.object({ title: z.string(), city: z.string().nullable().optional(), description: z.string(), sources: z.array(z.string()) })).min(1),
});

export const tourExperiences: Skill<BriefInput, TourExperiencesOutput> = {
  id: "tour.experiences",
  title: "Designing fan experiences",
  dependsOn: ["artist.resolve", "tour.cities"],
  // Waits for the venue step so it plans around the cities the user picked.
  optionalDeps: ["fans.dna", "fans.profile", "tour.venues"],
  timeoutMs: 60_000,
  output: tourExperiencesOutput,
  async run(ctx, input, deps) {
    const artist = artistFrom(deps);
    const { cities } = deps["tour.cities"].data as TourCitiesOutput;
    const dna = deps["fans.dna"]?.data as FansDnaOutput | undefined;
    const profile = deps["fans.profile"]?.data as { categories: { label: string; items: { id: string; name: string }[] }[] } | undefined;
    const stops = tourStops(cities, input.selections?.cities);

    const facts = new FactSheet();
    for (const c of stops) facts.add(`Tour city: ${c.name}`, { source: "qloo", entityId: c.id, label: c.name, query: `destinations · fans of ${artist.name}` });
    for (const t of (dna?.themes ?? []).slice(0, 6)) facts.add(`Fan theme "${t.name}": ${t.description}`, { source: "derived", label: t.name, basis: "fan DNA" });
    for (const cat of profile?.categories ?? []) {
      for (const it of cat.items.slice(0, 3)) facts.add(`Fans also love (${cat.label.toLowerCase()}): ${it.name}`, { source: "qloo", entityId: it.id, label: it.name, query: `${cat.label.toLowerCase()} · fans of ${artist.name}` });
    }

    if (ctx.llm) {
      try {
        const out = await ctx.llm.json({
          tier: "fast",
          schema: experiencesModel,
          maxTokens: 1200,
          temperature: 0.7,
          signal: ctx.signal,
          system: [
            "You design fan experiences for a music tour: pop-ups, meet-ups, listening sessions, collaborations with things the fans love. Practical and specific, doable by a small team.",
            GROUNDING_RULES,
            "Return 5 ideas. city must be one of the tour cities in the facts, or null.",
            languageRule(input),
            'Shape: {"ideas":[{"title":"3-6 words","city":"…"|null,"description":"one or two sentences","sources":["f1"]}]}',
          ].join("\n"),
          user: `Artist: ${artist.name}\n\nFacts:\n${facts.render()}`,
        });
        const cityNames = new Set(stops.map((s) => s.name));
        const ideas = out.ideas
          .map((i) => ({ title: i.title.trim().slice(0, 80), city: i.city && cityNames.has(i.city) ? i.city : null, description: i.description.trim().slice(0, 400), sources: facts.keep(i.sources) }))
          .filter((i) => i.sources.length > 0)
          .slice(0, 6);
        if (ideas.length >= 2) {
          const used = [...new Set(ideas.flatMap((i) => i.sources))];
          return { data: { ideas, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "model" }, evidence: facts.evidenceFor(used) };
        }
      } catch (err) {
        ctx.log.warn("Experience ideas failed; using template", { error: String(err) });
      }
    }
    const themeFacts = facts.all().filter((f) => f.text.startsWith("Fan theme"));
    const cityFacts = facts.all().filter((f) => f.text.startsWith("Tour city"));
    const ideas = cityFacts.slice(0, 4).map((c, i) => {
      const t = themeFacts[i % Math.max(1, themeFacts.length)];
      const themeName = t ? t.text.match(/"([^"]+)"/)?.[1] ?? "fan" : "fan";
      const cityName = c.text.replace("Tour city: ", "");
      return { title: `${themeName} night in ${cityName}`, city: cityName, description: `A small pre-show gathering built around the fanbase's "${themeName}" side.`, sources: t ? [c.id, t.id] : [c.id] };
    });
    const used = [...new Set(ideas.flatMap((i) => i.sources))];
    return { data: { ideas, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "template" }, evidence: facts.evidenceFor(used) };
  },
};
