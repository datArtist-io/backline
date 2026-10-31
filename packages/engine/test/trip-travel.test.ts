// "Getting there": distance, citing prices, and never offering made-up options.
import { describe, expect, it } from "vitest";
import { haversineKm, shapeTravel, tripTravel } from "../src/skills/trip-travel";
import type { WebResult } from "../src/clients/web";

const src = (n: number): WebResult => ({ title: `T${n}`, url: `https://www.site${n}.com/p`, snippet: "s", content: "c", publishedDate: null }) as unknown as WebResult;

describe("haversineKm", () => {
  it("measures real distances", () => {
    expect(haversineKm({ lat: 7.3775, lon: 3.947 }, { lat: 6.5244, lon: 3.3792 })).toBeGreaterThan(105);
    expect(haversineKm({ lat: 7.3775, lon: 3.947 }, { lat: 6.5244, lon: 3.3792 })).toBeLessThan(125);
    expect(haversineKm({ lat: 51.5, lon: -0.12 }, { lat: 48.85, lon: 2.35 })).toBeGreaterThan(330);
  });
});

describe("shapeTravel", () => {
  const sources = [src(1), src(2)];
  it("keeps prices only when a source backs them, and marks exactly one option best", () => {
    const r = shapeTravel(
      {
        options: [
          { mode: "train", title: "Intercity train", duration: "2 h 30 min", priceMin: 6000, priceMax: 9000, currency: "ngn", note: null, source: "w1", best: true },
          { mode: "bus", title: "Coach", duration: "3 h", priceMin: 5000, priceMax: 8000, currency: "NGN", note: null, source: null, best: true },
          { mode: "spaceship", title: "Odd", duration: null, priceMin: null, priceMax: null, currency: null, note: null, source: "w9", best: false },
        ],
      },
      sources
    );
    expect(r.options[0]).toMatchObject({ mode: "train", priceMin: 6000, priceMax: 9000, currency: "NGN", verified: true, site: "site1.com", best: true });
    expect(r.options[1]).toMatchObject({ mode: "bus", priceMin: null, priceMax: null, currency: null, verified: false, best: false });
    expect(r.options[2].mode).toBe("other");
    expect(r.options.filter((o) => o.best)).toHaveLength(1);
    expect(r.used).toHaveLength(1);
  });
  it("marks the first best when the model didn't", () => {
    const r = shapeTravel({ options: [{ mode: "car", title: "Drive", source: "w2" }] }, sources);
    expect(r.options[0].best).toBe(true);
  });
  it("drops options with no title and caps at four", () => {
    const o = (i: number) => ({ mode: "bus", title: i === 0 ? "" : `Bus ${i}`, source: "w1" });
    const r = shapeTravel({ options: [o(0), o(1), o(2), o(3), o(4), o(5)] }, sources);
    expect(r.options).toHaveLength(4);
  });
});

describe("tripTravel", () => {
  const log = { warn() {}, info() {}, error() {}, debug() {} };
  const base = { log, progress: () => {}, signal: undefined } as never;
  it("does nothing without a different origin", async () => {
    const r = await tripTravel.run({ ...(base as object) } as never, { artist: "", trip: { destination: "Lagos, Nigeria", origin: "Lagos" } } as never, {});
    expect(r.data.options).toEqual([]);
  });
  it("reads the web and cites the route options", async () => {
    const ctx = {
      ...(base as object),
      osm: { geocode: async (q: string) => [q.startsWith("Ibadan") ? { lat: 7.3775, lon: 3.947 } : { lat: 6.5244, lon: 3.3792 }] },
      web: { search: async () => [src(1), src(2)] },
      llm: { json: async () => ({ options: [{ mode: "train", title: "Lagos–Ibadan train", duration: "about 2 h 30", priceMin: 6000, priceMax: 9000, currency: "NGN", source: "w1", best: true }] }) },
    };
    const r = await tripTravel.run(ctx as never, { artist: "", trip: { destination: "Lagos, Nigeria", origin: "Ibadan", startDate: "2026-11-01" } } as never, {});
    expect(r.data.km).toBeGreaterThan(100);
    expect(r.data.options[0]).toMatchObject({ mode: "train", verified: true });
    expect(r.evidence.length).toBe(1);
  });
  it("never leaves getting there blank, and never invents a fare", async () => {
    const ctx = { ...(base as object), osm: null, web: { search: async () => [] }, llm: { json: async () => ({}) } };
    const r = await tripTravel.run(ctx as never, { artist: "", trip: { destination: "Paris, France", origin: "London" } } as never, {});
    expect(r.data.options[0]).toMatchObject({ mode: "flight", priceMin: null, priceMax: null });
    expect(r.data.options[0].url).toMatch(/google\.com\/travel\/flights/);
  });
});
