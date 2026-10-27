// Taste profile: reading tags, age lean, the heatmap zone, match scores and taste in the request.
// All data is synthetic.
import { describe, expect, it, vi } from "vitest";
import type { HeatPoint } from "../src/clients/qloo";
import { ageLean, heatForMap, readLike, readTags, tasteHit, tasteZone, tripTaste } from "../src/skills/taste";
import { withMatch } from "../src/skills/places";
import { createState, reviewPicks, tasteLabel, zoneOf } from "../src/skills/trip-agent";
import { likesIn, withStatedLikes } from "../src/missions";
import { groundTrip, normalizeTrip } from "../src/trip-request";
import { areaName } from "../src/clients/osm";
import { ctxWith, entity, stubQloo } from "./helpers";

const tag = (name: string, type: string) => ({ id: `urn:tag:x:${name}`, name, type, affinity: 1 });
const pt = (lat: number, lon: number, affinity = 1, popularity = 0.8): HeatPoint => ({ lat, lon, geohash: null, affinity, popularity });

describe("readTags", () => {
  it("keeps place vibes, scenes and dishes, and reads the price lean", () => {
    const out = readTags([
      tag("Feel-Good", "urn:tag:style:qloo"),
      tag("Docudrama-Like", "urn:tag:style:qloo"),
      tag("Hotel", "urn:tag:genre:place"),
      tag("West African", "urn:tag:genre:place"),
      tag("Suya", "urn:tag:specialty_dish:place"),
      tag("Moderately expensive", "urn:tag:cost_description:place"),
    ]);
    expect(out).toEqual({ vibes: ["Feel-Good"], scenes: ["West African"], dishes: ["Suya"], priceLean: 3 });
  });
});

describe("ageLean", () => {
  it("joins two neighbouring bands that lean almost equally", () => {
    expect(ageLean([{ entityId: null, age: { "24_and_younger": -0.05, "25_to_29": 0.41, "30_to_34": 0.45, "35_to_44": 0.01 }, gender: {} }])).toBe("25–34");
  });
  it("gives one band when it clearly leads, and null without a lean", () => {
    expect(ageLean([{ entityId: null, age: { "24_and_younger": 0.6, "25_to_29": 0.1 }, gender: {} }])).toBe("under 25");
    expect(ageLean([{ entityId: null, age: { "25_to_29": 0.01 }, gender: {} }])).toBeNull();
    expect(ageLean([])).toBeNull();
  });
});

describe("tasteZone", () => {
  it("finds the densest cluster of strong points", () => {
    const vi_ = [pt(6.43, 3.42), pt(6.431, 3.425), pt(6.428, 3.418), pt(6.435, 3.43)];
    const far = [pt(6.6, 3.35, 1, 0.1), pt(6.62, 3.3, 0.9, 0.1)];
    const z = tasteZone([...far, ...vi_]);
    expect(z).not.toBeNull();
    expect(z!.lat).toBeCloseTo(6.43, 1);
    expect(z!.lon).toBeCloseTo(3.42, 1);
    expect(z!.points).toBe(4);
  });
  it("needs at least three points close together", () => {
    expect(tasteZone([pt(6.4, 3.4), pt(6.7, 3.1)])).toBeNull();
  });
});

describe("heatForMap", () => {
  it("sorts strongest first and scales weights 0–1", () => {
    const out = heatForMap([pt(1, 1, 0.5, 0.5), pt(2, 2, 1, 1), pt(3, 3, 0.8, 0.5)]);
    expect(out[0]).toEqual([2, 2, 1]);
    expect(out[out.length - 1][2]).toBe(0);
  });
});

describe("withMatch", () => {
  it("ranks Qloo places by affinity, best 1 and last 0.5", () => {
    const base = { address: null, phone: null, email: null, website: null, priceLevel: null, rating: null, image: null, lat: null, lon: null, tags: [], fit: 0, why: [], priceNote: null, extra: null, sources: [] };
    const out = withMatch([
      { ...base, id: "a", name: "A", affinity: 0.97 },
      { ...base, id: "b", name: "B", affinity: 0.99 },
      { ...base, id: "c", name: "C", affinity: null },
      { ...base, id: "d", name: "D", affinity: 0.98 },
    ]);
    expect(out.map((p) => p.match ?? null)).toEqual([0.5, 1, null, 0.75]);
  });
});

describe("tasteHit", () => {
  it("skips towns and streets", () => {
    expect(tasteHit([entity({ id: "L", name: "Suya", type: "urn:entity:locality" }), entity({ id: "P", name: "Suya Spot", type: "urn:entity:place" })])?.id).toBe("P");
    expect(tasteHit([entity({ id: "L", name: "Suya", type: "urn:entity:locality" })])).toBeNull();
  });
});

describe("readLike", () => {
  const jazzTag = { id: "urn:tag:genre:music:jazz", name: "Jazz", type: "urn:tag:genre:music", affinity: null };
  const jazzFilm = entity({ id: "M", name: "Jazz", type: "urn:entity:movie" });
  it("reads a lower-case genre as a tag, a capitalised name as the entity", () => {
    expect(readLike("jazz", [jazzFilm], [jazzTag])).toEqual({ tag: jazzTag });
    expect(readLike("Jazz", [jazzFilm], [jazzTag])).toEqual({ entity: jazzFilm });
    const wiz = entity({ id: "W", name: "Wizkid" });
    expect(readLike("wizkid", [wiz], [])).toEqual({ entity: wiz });
    const suya = { id: "urn:tag:specialty_dish:place:suya", name: "Suya", type: "urn:tag:specialty_dish:place", affinity: null };
    expect(readLike("suya", [entity({ id: "L", name: "Suya", type: "urn:entity:locality" })], [suya])).toEqual({ tag: suya });
    expect(readLike("nothing", [], [])).toBeNull();
  });
});

describe("likesIn", () => {
  it("reads tastes from the request", () => {
    expect(likesIn("Weekend in Lagos, I love jazz and suya")).toEqual(["jazz", "suya"]);
    expect(likesIn("I'm a big Wizkid fan, plan my night out in Lekki")).toEqual(["Wizkid"]);
    expect(likesIn("we're really into afrobeats and seafood in Accra")).toEqual(["afrobeats", "seafood"]);
    expect(likesIn("Book a hotel near the National Theatre")).toEqual([]);
    expect(likesIn("Weekend in Lagos, I love Wizkid and jazz, budget 500000 naira")).toEqual(["Wizkid", "jazz"]);
  });
});

describe("withStatedLikes", () => {
  it("adds tastes the sentence states when the model leaves them out", () => {
    expect(withStatedLikes({ likes: [] }, "Lagos weekend, I love Wizkid and jazz")?.likes).toEqual(["Wizkid", "jazz"]);
    expect(withStatedLikes({ likes: ["jazz"] }, "I love Jazz")?.likes).toEqual(["jazz"]);
    expect(withStatedLikes({ inspiredBy: "Burna Boy", likes: null }, "a weekend like Burna Boy would, I love burna boy")?.likes).toEqual([]);
  });
});

describe("likes on the trip", () => {
  it("keeps only tastes the user said", () => {
    const raw = groundTrip({ destination: "Lagos, Nigeria", likes: ["jazz", "Burna Boy"] }, "Lagos weekend, I love jazz");
    expect(raw?.likes).toEqual(["jazz"]);
    expect(normalizeTrip(raw, "Lagos")!.likes).toEqual(["jazz"]);
  });
});

describe("grounding the landmark", () => {
  it("drops a landmark the user never named on the first read", () => {
    expect(groundTrip({ destination: "Lagos", near: "National Theatre" }, "Plan a weekend in Lagos like Burna Boy would", { near: true })?.near).toBeNull();
    expect(groundTrip({ destination: "Lagos", near: "National Theatre" }, "Hotel near the national theatre in Lagos", { near: true })?.near).toBe("National Theatre");
    expect(groundTrip({ destination: "Lekki", near: "seafood", likes: ["seafood"] }, "Dinner in Lekki, we love seafood", { near: true })?.near).toBeNull();
  });
});

describe("areaName", () => {
  it("prefers the suburb", () => {
    expect(areaName({ address: { suburb: "Victoria Island", city: "Lagos" } })).toBe("Victoria Island");
    expect(areaName({ address: { town: "Lekki Phase I", suburb: "Maroko", county: "Eti Osa" } })).toBe("Lekki Phase I");
    expect(areaName({ address: { suburb: "Soho", city: "London", town: "London" } })).toBe("Soho");
    expect(areaName({ address: { city: "Lagos" } })).toBe("Lagos");
    expect(areaName({})).toBeNull();
  });
});

describe("tasteLabel", () => {
  it("names the celebrity first, then the tastes", () => {
    expect(tasteLabel({ inspiredBy: "Burna Boy" }, null)).toBe("Loved by fans of Burna Boy");
    expect(tasteLabel({ inspiredBy: null }, { signals: [{ id: "1", name: "Wizkid", type: null }], tags: [{ id: "t", name: "Jazz" }] })).toBe("Loved by fans of Wizkid and Jazz");
    expect(tasteLabel({ inspiredBy: null }, null)).toBeUndefined();
  });
});

describe("trip.taste", () => {
  const trip = normalizeTrip({ destination: "Lagos, Nigeria", likes: ["Wizkid", "jazz"] }, "Lagos")!;

  it("builds the profile from Qloo: signals, themes, audience, also loved and the zone", async () => {
    const heat = [pt(6.43, 3.42), pt(6.431, 3.425), pt(6.428, 3.418), pt(6.6, 3.3, 0.5, 0.1)];
    const qloo = stubQloo({
      search: vi.fn(async (q: string) => (q === "Wizkid" ? [entity({ id: "W", name: "Wizkid", image: "https://img/w.jpg" })] : [entity({ id: "L", name: "Jazz", type: "urn:entity:locality" })])),
      findTags: vi.fn(async () => [{ id: "urn:tag:genre:music:jazz", name: "Jazz", type: "urn:tag:genre:music", affinity: null }]),
      tagInsights: vi.fn(async () => [tag("Feel-Good", "urn:tag:style:qloo"), tag("Bar", "urn:tag:genre:place")]),
      demographics: vi.fn(async () => [{ entityId: "W", age: { "25_to_29": 0.4, "30_to_34": 0.45 }, gender: {} }]),
      insights: vi.fn(async (type: string) => (type === "urn:entity:artist" ? [entity({ id: "W", name: "Wizkid" }), entity({ id: "D", name: "Davido" })] : [entity({ id: "B", name: "Brand Co", type: "urn:entity:brand" })])),
      heatmap: vi.fn(async () => heat),
    });
    const ctx = { ...ctxWith({ qloo }), osm: { reverse: vi.fn(async () => "Victoria Island") } } as unknown as Parameters<typeof tripTaste.run>[0];
    const r = await tripTaste.run(ctx, { artist: "", trip, profile: {} }, {});
    expect(r.data.signals.map((s) => s.name)).toEqual(["Wizkid"]);
    expect(r.data.tags).toEqual([{ id: "urn:tag:genre:music:jazz", name: "Jazz" }]);
    expect(r.data.vibes).toEqual(["Feel-Good"]);
    expect(r.data.scenes).toEqual(["Bar"]);
    expect(r.data.audience).toBe("25–34");
    expect(r.data.alsoLoved.map((x) => x.name)).toEqual(["Davido", "Brand Co"]);
    expect(r.data.zone?.name).toBe("Victoria Island");
    expect(r.data.heat.length).toBe(4);
    expect((qloo.heatmap as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([["W"], "Lagos, Nigeria", undefined, { tagIds: ["urn:tag:genre:music:jazz"] }]);
  });

  it("reads the destination through Qloo when no taste is given", async () => {
    const qloo = stubQloo({
      search: vi.fn(async () => [entity({ id: "DXB", name: "Dubai", type: "urn:entity:destination" })]),
      tagInsights: vi.fn(async () => [tag("Upscale", "urn:tag:style:qloo")]),
      demographics: vi.fn(async () => []),
      insights: vi.fn(async () => []),
      heatmap: vi.fn(async () => []),
    });
    const r = await tripTaste.run(ctxWith({ qloo }), { artist: "", trip: normalizeTrip({ destination: "Dubai" }, "Dubai")!, profile: {} }, {});
    expect(r.data.signals).toEqual([expect.objectContaining({ id: "DXB", from: "place" })]);
    expect(r.data.vibes).toEqual(["Upscale"]);
    expect(r.notes?.[0]).toMatch(/You didn't say what you love/);
  });

  it("says so when there's no taste to read", async () => {
    const r = await tripTaste.run(ctxWith(), { artist: "", trip: normalizeTrip({ destination: "Lagos" }, "Lagos")!, profile: {} }, {});
    expect(r.data.signals).toEqual([]);
    expect(r.notes?.[0]).toMatch(/No taste/);
  });
});

describe("zoneOf", () => {
  it("centres searches on the taste zone when it lies in the pinned city", () => {
    const trip = normalizeTrip({ destination: "Lagos" }, "Lagos")!;
    const s = createState({ artist: "", trip }, trip, "2026-10-23", {
      signals: [],
      tags: [],
      vibes: [],
      scenes: [],
      dishes: [],
      priceLean: null,
      audience: null,
      alsoLoved: [],
      zone: { name: "Victoria Island", lat: 6.43, lon: 3.42, radiusKm: 2, points: 5 },
      heat: [],
    });
    expect(zoneOf(s)).toBeNull();
    s.city = { name: "Lagos", display: "Lagos, Nigeria", lat: 6.45, lon: 3.39, country: "Nigeria", countryCode: "NG", source: "test" };
    expect(zoneOf(s)?.name).toBe("Victoria Island");
    s.city = { ...s.city, lat: 9.07, lon: 7.4 }; // Abuja, about 520 km away
    expect(zoneOf(s)).toBeNull();
  });
});

describe("the agent's self-review", () => {
  const trip = normalizeTrip({ destination: "Lagos", priceTier: 2 }, "Lagos")!;
  const pl = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id.toUpperCase(),
    address: null,
    phone: null,
    email: null,
    website: null,
    priceLevel: 2,
    rating: 4.2,
    affinity: 0.98,
    image: null,
    lat: 6.45,
    lon: 3.4,
    tags: [],
    fit: 0.5,
    why: [],
    priceNote: null,
    extra: null,
    sources: [],
    kind: "stay" as const,
    ...extra,
  });
  const stateWith = (places: ReturnType<typeof pl>[], tasteOn = false) => {
    const s = createState({ artist: "", trip }, trip, "2026-10-23", null);
    if (tasteOn) s.signals = ["W"];
    places.forEach((p, i) => {
      s.places.set(p.id, p);
      s.refOf.set(p.id, `s${i + 1}`);
      s.refs.set(`s${i + 1}`, p.id);
    });
    return s;
  };

  it("questions a pick well above budget once, unless the reason explains it", () => {
    const s = stateWith([pl("lux", { priceLevel: 4 })]);
    expect(reviewPicks({ stays: [{ id: "s1", why: "Great view" }] }, s)).toMatch(/above their budget/);
    expect(reviewPicks({ stays: [{ id: "s1", why: "Great view" }] }, s)).toBeNull();
    const s2 = stateWith([pl("lux", { priceLevel: 4 })]);
    expect(reviewPicks({ stays: [{ id: "s1", why: "Worth the splurge for the pool" }] }, s2)).toBeNull();
  });

  it("points to stronger taste matches the picks ignored", () => {
    const s = stateWith([pl("weak", { match: 0.5, fit: 0.9 }), pl("strong", { match: 0.95, fit: 0.6 })], true);
    expect(reviewPicks({ stays: [{ id: "s1", why: "Close" }] }, s)).toMatch(/s2 \(STRONG\) is a top taste match/);
  });

  it("asks for a price check on the hotel when research is connected", () => {
    const s = stateWith([pl("h")]);
    s.canCheck = true;
    expect(reviewPicks({ stays: [{ id: "s1", why: "Close" }] }, s)).toMatch(/check_places/);
    const off = stateWith([pl("h")]);
    expect(reviewPicks({ stays: [{ id: "s1", why: "Close" }] }, off)).toBeNull();
  });
});
