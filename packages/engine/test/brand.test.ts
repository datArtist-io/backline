import { describe, expect, it, vi } from "vitest";
import { ageRange, rangesOverlap, scoreBrand, brandMatches } from "../src/skills/brand-matches";
import { brandPitches, pickBrands } from "../src/skills/brand-pitches";
import { brandResearch, researchTargets } from "../src/skills/brand-research";
import type { SkillResult } from "../src/types";
import type { WebSearch } from "../src/clients/web";
import { ARTIST, ctxWith, entity, stubLlm, stubQloo } from "./helpers";

const resolved = (props: Record<string, unknown> = {}): Record<string, SkillResult<unknown>> => ({
  "artist.resolve": { data: { artist: { id: ARTIST.id, name: ARTIST.name, type: "urn:entity:artist", image: null, popularity: 0.9, properties: { primary_genres: "afro-fusion", ...props } }, alternatives: [] }, evidence: [] },
});

const brand = (id: string, affinity: number, properties: Record<string, unknown> = {}) => entity({ id, name: `Brand ${id}`, type: "urn:entity:brand", affinity, properties });

describe("brand scoring", () => {
  it("parses age ranges", () => {
    expect(ageRange("18-34")).toEqual([18, 34]);
    expect(ageRange("25 to 44 year olds")).toEqual([25, 44]);
    expect(ageRange("55 and older")).toEqual([55, 99]);
    expect(ageRange(null)).toBeNull();
    expect(rangesOverlap([18, 34], [25, 29])).toBe(true);
    expect(rangesOverlap([45, 54], [25, 29])).toBe(false);
  });

  it("rewards music history, age overlap and market presence", () => {
    const base = { artistName: "A", associated: new Set<string>(), strongestAge: "25–29", location: "Lagos, Nigeria" };
    const plain = scoreBrand(brand("1", 0.8), base);
    const rich = scoreBrand(brand("2", 0.8, { known_partnerships: ["Music festival sponsor"], target_age_group: "18-34", key_markets: ["Nigeria", "UK"] }), base);
    expect(rich.fit).toBeGreaterThan(plain.fit);
    expect(rich.reasons.length).toBe(4);
    expect(rich.reasons.join(" ")).toContain("Nigeria");
  });

  it("flags brands the artist already works with", () => {
    const m = scoreBrand(brand("3", 0.9), { artistName: "A", associated: new Set(["brand 3"]), strongestAge: null, location: null });
    expect(m.alreadyPartnered).toBe(true);
  });
});

describe("brand.matches", () => {
  it("falls back to all brands when a focus filter finds nothing, and says so", async () => {
    const insights = vi.fn(async (_t: string, p: { filterTags?: string[] }) => (p.filterTags ? [] : [brand("1", 0.9), brand("2", 0.7)]));
    const findTags = vi.fn(async () => [{ id: "urn:tag:category:brand:sportswear", name: "Sportswear", type: "urn:tag:category:brand", affinity: null }]);
    const res = await brandMatches.run(ctxWith({ qloo: stubQloo({ insights, findTags }) }), { artist: "x", focus: "sportswear" }, resolved());
    expect(insights).toHaveBeenCalledTimes(2);
    expect(res.data.focusApplied).toBe(false);
    expect(res.notes?.[0]).toContain("sportswear");
    expect(res.data.matches.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("puts already-partnered brands last", async () => {
    const insights = vi.fn(async () => [brand("1", 0.95), brand("2", 0.6)]);
    const res = await brandMatches.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x" }, resolved({ associated_brands: ["Brand 1"] }));
    expect(res.data.matches.map((m) => m.id)).toEqual(["2", "1"]);
  });
});

const matchesResult = (ids: string[], partnered: string[] = []) => ({
  "brand.matches": {
    data: { focus: null, focusApplied: false, matches: ids.map((id, i) => ({ id, name: `Brand ${id}`, image: null, affinity: 0.9 - i * 0.1, fit: 0.8 - i * 0.1, reasons: [`Brand ${id} reason`], alreadyPartnered: partnered.includes(id), positioning: null, markets: [], targetAge: null, partnerships: [] })) },
    evidence: [],
  },
});

describe("brand.research", () => {
  it("is skipped cleanly without a web key", async () => {
    const res = await brandResearch.run(ctxWith(), { artist: "x" }, matchesResult(["1"]));
    expect(res.data.enabled).toBe(false);
  });

  it("keeps only findings that cite real sources", async () => {
    const tavily = { search: vi.fn(async () => [{ title: "Brand 1 launches music fund", url: "https://news.example/a", content: "…", publishedDate: null }]) } as unknown as WebSearch;
    const llm = stubLlm(() => ({ findings: [{ text: "Launched a music fund", source: "w1" }, { text: "Made up", source: "w9" }], angle: "Wants creators", contactRoute: null }));
    const ctx = { ...ctxWith({ llm }), web: tavily };
    const res = await brandResearch.run(ctx, { artist: "x" }, matchesResult(["1"]));
    expect(res.data.brands[0].findings).toEqual([{ text: "Launched a music fund", url: "https://news.example/a", title: "Brand 1 launches music fund" }]);
    expect(res.evidence[0]).toMatchObject({ source: "web", url: "https://news.example/a" });
  });

  it("researches picked brands first", () => {
    const targets = researchTargets(matchesResult(["1", "2", "3"])["brand.matches"].data.matches, ["3"]);
    expect(targets[0].id).toBe("3");
  });
});

describe("brand.pitches", () => {
  it("pitches the user's picks, else the strongest new matches", () => {
    const { matches } = matchesResult(["1", "2", "3", "4"], ["1"])["brand.matches"].data;
    expect(pickBrands(matches).map((m) => m.id)).toEqual(["2", "3", "4"]);
    expect(pickBrands(matches, ["4", "nope"]).map((m) => m.id)).toEqual(["4"]);
  });

  it("drops cited facts that don't exist and falls back to a template when none are valid", async () => {
    const llm = stubLlm(() => ({ subject: "Hello", hook: "Hook", body: "x".repeat(60), ask: "Call?", factsUsed: ["f999"] }));
    const res = await brandPitches.run(ctxWith({ llm }), { artist: "x", selections: { brands: ["2"] } }, { ...resolved(), ...matchesResult(["1", "2"]) });
    expect(res.data.pitches).toHaveLength(1);
    expect(res.data.pitches[0].brandId).toBe("2");
    expect(res.data.pitches[0].method).toBe("template");
    expect(res.data.pitches[0].body).toContain("[Your name]");
  });

  it("uses the model's pitch when it cites real facts", async () => {
    const llm = stubLlm(() => ({ subject: "Test Artist × Brand 2", hook: "Hook", body: "y".repeat(80), ask: "Call?", factsUsed: ["f1", "f2"] }));
    const res = await brandPitches.run(ctxWith({ llm }), { artist: "x" }, { ...resolved(), ...matchesResult(["2"]) });
    expect(res.data.pitches[0].method).toBe("model");
    expect(res.data.pitches[0].facts.map((f) => f.id)).toEqual(["f1", "f2"]);
  });
});
