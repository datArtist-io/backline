import { describe, expect, it, vi } from "vitest";
import { audienceSimilarity, compareArtists, compareBrands, fansSegments, overlap, pickWinner } from "../src/skills/compare";
import { keywordPlan, splitVersus } from "../src/missions";
import type { SkillResult } from "../src/types";
import { ARTIST, ctxWith, entity, stubQloo } from "./helpers";

const resolved: Record<string, SkillResult<unknown>> = {
  "artist.resolve": { data: { artist: { id: ARTIST.id, name: ARTIST.name, type: "urn:entity:artist", image: null, popularity: 0.5, properties: {} }, alternatives: [] }, evidence: [] },
};

describe("comparison helpers", () => {
  it("scores audience similarity from age vectors", () => {
    expect(audienceSimilarity([0.5, 0.2, -0.1], [0.5, 0.2, -0.1])).toBe(1);
    expect(audienceSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(audienceSimilarity([0, 0], [1, 0])).toBeNull();
  });

  it("splits shared and unique items", () => {
    const o = overlap([entity({ id: "1", name: "One" }), entity({ id: "2", name: "Two" })], [entity({ id: "2", name: "Two" }), entity({ id: "3", name: "Three" })]);
    expect(o).toEqual({ shared: ["Two"], onlyA: ["One"], onlyB: ["Three"] });
  });

  it("picks a winner only when the data separates them", () => {
    expect(pickWinner([{ name: "A", rank: 2, audienceMatch: 0.8 }, { name: "B", rank: null, audienceMatch: 0.9 }])).toBe("A");
    expect(pickWinner([{ name: "A", rank: null, audienceMatch: null }, { name: "B", rank: null, audienceMatch: null }])).toBeNull();
  });
});

describe("compare planning", () => {
  it("parses versus phrasings", () => {
    expect(splitVersus("Test Artist vs Other Artist")).toEqual(["Test Artist", "Other Artist"]);
    expect(splitVersus("compare Test Artist's fans with Other Artist")).toEqual(["Test Artist", "Other Artist"]);
  });

  it("tells artist comparisons from brand head-to-heads", () => {
    expect(keywordPlan("Test Artist vs Other Artist")).toMatchObject({ mission: "compare", artist: "Test Artist", compareWith: "Other Artist", compareBrands: null });
    expect(keywordPlan("Brand A vs Brand B for Test Artist")).toMatchObject({ mission: "compare", artist: "Test Artist", compareBrands: ["Brand A", "Brand B"] });
  });
});

describe("comparison skills", () => {
  it("does nothing when there's nothing to compare", async () => {
    expect((await compareArtists.run(ctxWith(), { artist: "x" }, resolved)).data.applicable).toBe(false);
    expect((await compareBrands.run(ctxWith(), { artist: "x", compareBrands: ["Only one"] }, resolved)).data.applicable).toBe(false);
  });

  it("compares two fanbases", async () => {
    const R = entity({ id: "R", name: "Other Artist" });
    const insights = vi.fn(async (_t: string, p: { entityIds?: string[] }) =>
      p.entityIds?.[0] === "R" ? [entity({ id: "s", name: "Shared" }), entity({ id: "r", name: "Rival only" })] : [entity({ id: "s", name: "Shared" }), entity({ id: "a", name: "Mine" })]
    );
    const qloo = stubQloo({ search: vi.fn(async () => [R]), insights, demographics: vi.fn(async () => [{ entityId: null, age: { "25_to_29": 0.4 }, gender: {} }]) });
    const res = await compareArtists.run(ctxWith({ qloo }), { artist: "x", compareWith: "Other Artist" }, resolved);
    expect(res.data.rival?.name).toBe("Other Artist");
    expect(res.data.shared).toContain("Shared");
    expect(res.data.onlyRival).toContain("Rival only");
    expect(res.data.onlyArtist).toContain("Mine");
    expect(res.data.takeaways.length).toBeGreaterThan(1);
  });

  it("ranks brands by where they sit in the fans' top brands", async () => {
    const A = entity({ id: "BA", name: "Brand A", type: "urn:entity:brand" });
    const B = entity({ id: "BB", name: "Brand B", type: "urn:entity:brand" });
    const qloo = stubQloo({
      insights: vi.fn(async () => [entity({ id: "z", name: "Z" }), A]),
      search: vi.fn(async (q: string) => (q === "Brand A" ? [A] : [B])),
      demographics: vi.fn(async () => []),
    });
    const res = await compareBrands.run(ctxWith({ qloo }), { artist: "x", compareBrands: ["Brand A", "Brand B"] }, resolved);
    expect(res.data.brands.map((b) => b.rank)).toEqual([2, null]);
    expect(res.data.winner).toBe("Brand A");
  });

  it("finds what each age segment loves that others don't", async () => {
    const insights = vi.fn(async (_t: string, p: { age?: string }) => [entity({ id: `x-${p.age}`, name: `Only ${p.age}` }), entity({ id: "common", name: "Common" })]);
    const demo = { "fans.demographics": { data: { available: true, ages: [{ band: "25_to_29", label: "25–29", index: 0.4 }, { band: "30_to_34", label: "30–34", index: 0.2 }], strongestAge: "25–29", gender: { male: null, female: null, lean: null, strength: null } }, evidence: [] } };
    const res = await fansSegments.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x" }, { ...resolved, ...demo });
    expect(res.data.segments.map((s) => s.label)).toEqual(["25–29", "30–34"]);
    expect(res.data.segments[0].unique).toContain("Only 25_to_29");
    expect(res.data.segments[0].unique).not.toContain("Common");
  });
});
