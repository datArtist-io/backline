import { describe, expect, it, vi } from "vitest";
import { InputError, NotFoundError, UpstreamError } from "../src/errors";
import { artistResolve, normalizeArtistName, pickBest } from "../src/skills/artist-resolve";
import { fansProfile, PROFILE_CATEGORIES } from "../src/skills/fans-profile";
import { fansDemographics, genderLean } from "../src/skills/fans-demographics";
import { buildCandidates, fallbackThemes, fansDna, phrases } from "../src/skills/fans-dna";
import type { SkillResult } from "../src/types";
import { ARTIST, ctxWith, entity, stubLlm, stubQloo } from "./helpers";

const resolved = (): Record<string, SkillResult<unknown>> => ({
  "artist.resolve": {
    data: {
      artist: { id: ARTIST.id, name: ARTIST.name, type: "urn:entity:artist", image: null, popularity: 0.9, properties: { adjectives_for_fans: ["loyal", "stylish"], primary_genres: "afro-fusion, soul" } },
      alternatives: [],
    },
    evidence: [],
  },
});

describe("artist.resolve", () => {
  it("prefers an exact name match over ranking", () => {
    const best = pickBest("beyonce", [entity({ id: "1", name: "Beyoncé Tribute Band" }), entity({ id: "2", name: "Beyoncé" })]);
    expect(best?.id).toBe("2");
  });

  it("validates the name", () => {
    expect(() => normalizeArtistName("   ")).toThrow(InputError);
    expect(() => normalizeArtistName("!!!")).toThrow(InputError);
    expect(normalizeArtistName("  Test   Artist ")).toBe("Test Artist");
  });

  it("falls back to an untyped search when no artist entity exists", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([entity({ id: "P1", name: "Test Artist", type: "urn:entity:person" }), entity({ id: "X", name: "Test Artist Movie", type: "urn:entity:movie" })]);
    const res = await artistResolve.run(ctxWith({ qloo: stubQloo({ search }) }), { artist: "Test Artist" }, {});
    expect(res.data.artist.id).toBe("P1");
    expect(res.data.alternatives).toHaveLength(0);
    expect(res.evidence[0]).toMatchObject({ source: "qloo", entityId: "P1" });
  });

  it("falls back to an untyped search when the typed search is rejected", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamError("qloo", 400, "bad type"))
      .mockResolvedValueOnce([entity({ id: "P2", name: "Test Artist", type: "urn:entity:person" })]);
    const res = await artistResolve.run(ctxWith({ qloo: stubQloo({ search }) }), { artist: "Test Artist" }, {});
    expect(res.data.artist.id).toBe("P2");
  });

  it("reports an unknown artist clearly", async () => {
    await expect(artistResolve.run(ctxWith(), { artist: "Nobody Known" }, {})).rejects.toThrow(NotFoundError);
  });
});

describe("fans.profile", () => {
  it("excludes the artist itself and records evidence for every item", async () => {
    const insights = vi.fn(async () => [ARTIST, entity({ id: "B1", name: "Brand One", affinity: 0.9 })]);
    const res = await fansProfile.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x" }, resolved());
    expect(insights).toHaveBeenCalledTimes(PROFILE_CATEGORIES.length);
    for (const c of res.data.categories) expect(c.items.map((i) => i.id)).toEqual(["B1"]);
    expect(res.evidence).toHaveLength(PROFILE_CATEGORIES.length);
  });

  it("keeps working when some categories fail", async () => {
    const insights = vi.fn(async (type: string) => {
      if (type === "urn:entity:book") throw new UpstreamError("qloo", 503, "down");
      return [entity({ id: "E1", name: "Thing", affinity: 0.8 })];
    });
    const res = await fansProfile.run(ctxWith({ qloo: stubQloo({ insights }) }), { artist: "x" }, resolved());
    const books = res.data.categories.find((c) => c.key === "books")!;
    expect(books.error).toBeTruthy();
    expect(res.notes?.some((n) => n.startsWith("Books"))).toBe(true);
  });

  it("fails when there is no data at all", async () => {
    await expect(fansProfile.run(ctxWith(), { artist: "x" }, resolved())).rejects.toThrow();
  });
});

describe("fans.demographics", () => {
  it("describes gender lean in plain language", () => {
    expect(genderLean(0.05, -0.05)).toEqual({ lean: "balanced", strength: null });
    expect(genderLean(0.3, -0.3)).toEqual({ lean: "male", strength: "clear" });
    expect(genderLean(-0.5, 0.5)).toEqual({ lean: "female", strength: "strong" });
    expect(genderLean(null, 0.2)).toEqual({ lean: null, strength: null });
  });

  it("finds the strongest age band", async () => {
    const demographics = vi.fn(async () => [{ entityId: ARTIST.id, age: { "24_and_younger": -0.1, "25_to_29": 0.3, "30_to_34": 0.4 }, gender: { male: 0.2, female: -0.2 } }]);
    const res = await fansDemographics.run(ctxWith({ qloo: stubQloo({ demographics }) }), { artist: "x" }, resolved());
    expect(res.data.available).toBe(true);
    expect(res.data.strongestAge).toBe("30–34");
    expect(res.data.ages.map((a) => a.band)).toEqual(["24_and_younger", "25_to_29", "30_to_34"]);
  });

  it("marks data unavailable instead of failing", async () => {
    const res = await fansDemographics.run(ctxWith(), { artist: "x" }, resolved());
    expect(res.data.available).toBe(false);
  });
});

describe("fans.dna", () => {
  const taggedBrand = entity({
    id: "B1",
    name: "Brand One",
    affinity: 0.9,
    tags: [
      { id: "t1", name: "Streetwear", type: "urn:tag:genre:brand" },
      { id: "t2", name: "Three Star", type: "urn:tag:hotel_rating:place" },
      { id: "t3", name: "VISA", type: "urn:tag:credit_card:place" },
    ],
  });

  it("splits property values into phrases", () => {
    expect(phrases("a, b ;c")).toEqual([]);
    expect(phrases("loyal fans, night owls")).toEqual(["loyal fans", "night owls"]);
    expect(phrases(["stylish", 3, ""])).toEqual(["stylish"]);
  });

  it("keeps taste tags and drops logistics noise", () => {
    const artist = (resolved()["artist.resolve"].data as { artist: Parameters<typeof buildCandidates>[0] }).artist;
    const c = buildCandidates(artist, [], [taggedBrand]);
    const texts = c.map((x) => x.text);
    expect(texts).toContain("Streetwear");
    expect(texts).not.toContain("Three Star");
    expect(texts).not.toContain("VISA");
    expect(texts).toContain("loyal");
    expect(c.every((x, i) => x.id === `c${i + 1}`)).toBe(true);
  });

  it("drops model themes whose sources don't exist", async () => {
    const llm = stubLlm(() => ({
      themes: [
        { name: "Style first", description: "d", strength: 0.9, sources: ["c1", "c999"] },
        { name: "Invented", description: "d", strength: 0.8, sources: ["c999"] },
        { name: "Soulful", description: "d", strength: 0.7, sources: ["c2"] },
        { name: "Loyal", description: "d", strength: 0.6, sources: ["c3"] },
      ],
    }));
    const insights = vi.fn(async () => [taggedBrand]);
    const res = await fansDna.run(ctxWith({ qloo: stubQloo({ insights }), llm }), { artist: "x" }, resolved());
    expect(res.data.method).toBe("model");
    expect(res.data.themes.map((t) => t.name)).toEqual(["Style first", "Soulful", "Loyal"]);
    expect(res.data.themes[0].sources).toEqual(["c1"]);
  });

  it("falls back to the strongest signals without a model", async () => {
    const res = await fansDna.run(ctxWith(), { artist: "x" }, resolved());
    expect(res.data.method).toBe("fallback");
    expect(res.data.themes.length).toBeGreaterThan(0);
    expect(fallbackThemes([])).toEqual([]);
  });
});
