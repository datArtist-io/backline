import { describe, expect, it } from "vitest";
import { densify } from "../src/app/adventure/route-ribbons";

describe("routes laid on the street", () => {
  it("places points at most ~14 m apart, ending exactly at the last stop", () => {
    // ~1.1 km due north.
    const d = densify([[2.17, 41.38], [2.17, 41.39]]);
    expect(d.lat.length).toBeGreaterThan(75);
    expect(d.lat.length).toBeLessThan(85);
    expect(d.along[0]).toBe(0);
    expect(d.along[d.along.length - 1]).toBe(1);
    expect(d.lat[d.lat.length - 1]).toBeCloseTo((41.39 * Math.PI) / 180, 9);
  });
  it("caps very long routes", () => {
    expect(densify([[2.0, 41.0], [2.0, 42.0]], 14, 500).lat.length).toBeLessThanOrEqual(502);
  });
});
