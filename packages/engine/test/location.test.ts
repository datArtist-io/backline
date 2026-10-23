import { describe, expect, it, vi } from "vitest";
import { broadeningLadder, distanceKm, findPlaces, normalizeLocation } from "../src/location";
import { ctxWith, entity, stubQloo } from "./helpers";

describe("normalizeLocation", () => {
  it("accepts places in any script", () => {
    for (const place of ["東京", "São Paulo", "Montréal", "Mumbai", "القاهرة", "Москва", "Kraków", "N'Djamena", "Washington, D.C."]) {
      expect(normalizeLocation(place)).toBe(place.normalize("NFC"));
    }
  });

  it("tidies spacing and commas", () => {
    expect(normalizeLocation("  Ikeja,Lagos ,  Nigeria ")).toBe("Ikeja, Lagos, Nigeria");
  });

  it("returns null for empty input", () => {
    expect(normalizeLocation("   ")).toBeNull();
    expect(normalizeLocation(undefined)).toBeNull();
  });

  it("rejects markup and overly long input", () => {
    expect(() => normalizeLocation("<script>alert(1)</script>")).toThrow();
    expect(() => normalizeLocation("a".repeat(81))).toThrow();
  });
});

describe("broadeningLadder", () => {
  it("widens from the most specific part", () => {
    expect(broadeningLadder("District 1, City, Country")).toEqual(["District 1, City, Country", "City, Country", "Country"]);
    expect(broadeningLadder("City")).toEqual(["City"]);
  });
});

describe("distanceKm", () => {
  it("computes great-circle distance", () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.19, 1);
    expect(distanceKm({ lat: 10, lon: 10 }, { lat: 10, lon: 10 })).toBe(0);
  });
});

describe("findPlaces", () => {
  const venue = (id: string, lat = 1, lon = 1) => entity({ id, name: `Venue ${id}`, type: "urn:entity:place", location: { lat, lon } });

  it("uses the exact location when it has data", async () => {
    const insights = vi.fn(async () => [venue("v1")]);
    const res = await findPlaces(ctxWith({ qloo: stubQloo({ insights }) }), ["A-0"], "Small Town, Region");
    expect(res.coverage).toBe("exact");
    expect(res.searched).toBe("Small Town, Region");
    expect(insights).toHaveBeenCalledTimes(1);
  });

  it("broadens to the parent area when the exact place is empty", async () => {
    const insights = vi.fn(async (_t: string, p: { filterLocation?: string }) => (p.filterLocation === "Region" ? [venue("v2")] : []));
    const res = await findPlaces(ctxWith({ qloo: stubQloo({ insights }) }), ["A-0"], "Small Town, Region");
    expect(res.coverage).toBe("broadened");
    expect(res.searched).toBe("Region");
  });

  it("searches a radius around the place and drops results that are actually far away", async () => {
    const anchor = entity({ id: "d1", name: "Small Town", type: "urn:entity:destination", location: { lat: 0, lon: 0 } });
    const insights = vi.fn(async (_t: string, p: { near?: unknown }) =>
      p.near ? [venue("near", 0, 0.1), venue("far", 40, 40)] : []
    );
    const search = vi.fn(async () => [anchor]);
    const res = await findPlaces(ctxWith({ qloo: stubQloo({ insights, search }) }), ["A-0"], "Small Town");
    expect(res.coverage).toBe("nearby");
    expect(res.items.map((i) => i.id)).toEqual(["near"]);
    expect(res.searched).toContain("Small Town");
  });

  it("reports no coverage honestly instead of inventing results", async () => {
    const res = await findPlaces(ctxWith(), ["A-0"], "Nowhere");
    expect(res).toEqual({ items: [], searched: "Nowhere", coverage: "none" });
  });
});
