import { describe, expect, it, vi } from "vitest";
import { planRoute, tourCities, tourRoute, tourStops, tourVenues, VENUE_TAG } from "../src/skills/tour";
import { collabTier, growthCollaborators, growthMarkets } from "../src/skills/growth";
import { buildAdBrief, contentAngles, contentRelease } from "../src/skills/content";
import type { SkillResult } from "../src/types";
import { ARTIST, ctxWith, entity, stubLlm, stubQloo } from "./helpers";

const resolved = (props: Record<string, unknown> = {}, popularity = 0.5): Record<string, SkillResult<unknown>> => ({
  "artist.resolve": { data: { artist: { id: ARTIST.id, name: ARTIST.name, type: "urn:entity:artist", image: null, popularity, properties: props }, alternatives: [] }, evidence: [] },
});
const city = (id: string, lat: number | null, lon: number | null, affinity = 0.5) => ({ id, name: `City ${id}`, affinity, lat, lon, image: null });

describe("tour", () => {
  it("routes from the strongest city by nearest neighbour", () => {
    const { order, km, unplaced } = planRoute([city("far", 0, 50, 0.4), city("start", 0, 0, 0.9), city("near", 0, 1, 0.5), city("none", null, null)]);
    expect(order.map((c) => c.id)).toEqual(["start", "near", "far"]);
    expect(km[0]).toBeNull();
    expect(km[1]).toBeGreaterThan(100);
    expect(unplaced.map((c) => c.id)).toEqual(["none"]);
  });

  it("uses picked cities, else the top five", () => {
    const cities = Array.from({ length: 8 }, (_, i) => city(String(i), 0, i));
    expect(tourStops(cities).length).toBe(5);
    expect(tourStops(cities, ["7", "2"]).map((c) => c.id)).toEqual(["7", "2"]);
  });

  it("widens a region that has no data and says so", async () => {
    const insights = vi.fn(async (_t: string, p: { filterLocation?: string }) => (p.filterLocation === "Nigeria" ? [entity({ id: "D1", name: "Lagos", type: "urn:entity:destination", location: { lat: 6.5, lon: 3.4 } })] : []));
    const res = await tourCities.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x", location: "Ikeja, Lagos State, Nigeria" }, resolved());
    expect(res.data.searched).toBe("Nigeria");
    expect(res.data.cities[0].name).toBe("Lagos");
    expect(res.notes?.[0]).toContain("Nigeria");
  });

  it("searches venues with the music-venue tag in each stop", async () => {
    const insights = vi.fn(async () => [entity({ id: "V1", name: "Hall", type: "urn:entity:place", properties: { address: "1 Road", website: "javascript:alert(1)" } })]);
    const deps = { ...resolved(), "tour.cities": { data: { region: null, searched: "worldwide", cities: [city("C1", 1, 1)] }, evidence: [] } };
    const res = await tourVenues.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x" }, deps);
    expect((insights.mock.calls[0] as unknown[])[0]).toBe("urn:entity:place");
    expect((insights.mock.calls[0] as unknown[])[1]).toMatchObject({ filterTags: [VENUE_TAG] });
    expect(res.data.stops[0].venues[0]).toMatchObject({ name: "Hall", address: "1 Road", website: null });
  });

  it("puts the top venue on each leg of the route", async () => {
    const deps = {
      "tour.cities": { data: { region: null, searched: "worldwide", cities: [city("A", 0, 0, 0.9), city("B", 0, 2)] }, evidence: [] },
      "tour.venues": { data: { stops: [{ cityId: "B", city: "City B", searched: "City B", coverage: "exact", venues: [{ id: "V", name: "Club B", address: null, affinity: 0.5, lat: 0, lon: 2, website: null }] }] }, evidence: [] },
    };
    const res = await tourRoute.run(ctxWith(), { artist: "x" }, deps);
    expect(res.data.legs.map((l) => [l.city, l.headliner])).toEqual([["City A", null], ["City B", "Club B"]]);
    expect(res.data.totalKm).toBeGreaterThan(200);
  });
});

describe("growth", () => {
  it("tiers collaborators by relative popularity", () => {
    expect(collabTier(0.5, 0.8)).toBe("reach");
    expect(collabTier(0.5, 0.52)).toBe("peer");
    expect(collabTier(0.5, 0.2)).toBe("rising");
    expect(collabTier(null, 0.2)).toBe("peer");
  });

  it("finds shared genres and excludes the artist", async () => {
    const insights = vi.fn(async () => [ARTIST, entity({ id: "S1", name: "Peer", popularity: 0.9, affinity: 0.8, properties: { primary_genres: "Afrobeats, R&B" } })]);
    const res = await growthCollaborators.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x" }, resolved({ primary_genres: "afrobeats, soul" }));
    expect(res.data.collaborators).toHaveLength(1);
    expect(res.data.collaborators[0]).toMatchObject({ tier: "reach", sharedGenres: ["Afrobeats"] });
  });

  it("leaves the home market out of new markets", async () => {
    const insights = vi.fn(async () => [entity({ id: "H", name: "Lagos", type: "urn:entity:destination" }), entity({ id: "N", name: "London", type: "urn:entity:destination" })]);
    const res = await growthMarkets.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x" }, resolved({ place_of_birth: "Lagos, Nigeria" }));
    expect(res.data.markets.map((m) => m.name)).toEqual(["London"]);
  });
});

describe("content", () => {
  const dna = { "fans.dna": { data: { themes: [{ name: "Night owls", description: "Late listeners", strength: 0.9, sources: ["c1"] }, { name: "Style first", description: "Fashion-led", strength: 0.8, sources: ["c2"] }, { name: "Soulful", description: "Warm", strength: 0.7, sources: ["c3"] }], candidates: [], method: "model" }, evidence: [] } };

  it("builds an ad brief only from known data", () => {
    const brief = buildAdBrief("A", {
      demo: { available: true, ages: [{ band: "25_to_29", label: "25–29", index: 0.4 }, { band: "45_to_54", label: "45–54", index: -0.3 }], strongestAge: "25–29", gender: { male: 0.1, female: -0.1, lean: "balanced", strength: null } },
    });
    expect(brief.ages).toEqual([{ label: "25–29", index: 0.4 }]);
    expect(brief.gender).toContain("balanced");
    expect(brief.interests).toEqual([]);
    expect(brief.summary).toContain("25–29");
  });

  it("drops angles that cite nothing real, and falls back to themes", async () => {
    const llm = stubLlm(() => ({ angles: [{ title: "Made up", format: "Short video", hook: "h", why: "w", sources: ["f99"] }] }));
    const res = await contentAngles.run(ctxWith({ llm }), { artist: "x" }, { ...resolved(), ...dna });
    expect(res.data.method).toBe("template");
    expect(res.data.angles.length).toBe(3);
    expect(res.data.angles.every((a) => a.sources.length > 0)).toBe(true);
  });

  it("plans six weeks even without a model", async () => {
    const angles = { "content.angles": { data: { angles: [{ title: "T", format: "Short video", hook: "H", why: "W", sources: ["f1"] }], facts: [], method: "template" }, evidence: [] } };
    const res = await contentRelease.run(ctxWith(), { artist: "x", focus: "New Single" }, { ...resolved(), ...angles });
    expect(res.data.weeks).toHaveLength(6);
    expect(res.data.title).toContain("New Single");
  });
});
