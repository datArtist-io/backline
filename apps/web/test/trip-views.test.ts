import { describe, expect, it } from "vitest";
import { tripViews } from "../src/app/adventure/trip-views";

describe("loading the trip's 3D city ahead", () => {
  it("places a viewpoint every few hundred metres, facing along the route", () => {
    // About 2.2 km due north.
    const views = tripViews([{ geo: [[2.17, 41.38], [2.17, 41.40]] }]);
    expect(views.length).toBeGreaterThanOrEqual(6);
    expect(views.length).toBeLessThanOrEqual(8);
    expect(views.every((v) => Math.abs(v.bearing) < 1 || Math.abs(v.bearing - 360) < 1)).toBe(true);
    // Due east faces 90°.
    expect(tripViews([{ geo: [[2.17, 41.38], [2.20, 41.38]] }])[0].bearing).toBeCloseTo(90, 0);
  });
  it("spreads long trips over at most the cap, and ignores empty routes", () => {
    const long = tripViews([{ geo: [[2.0, 41.0], [2.0, 42.0]] }], 50);
    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.length).toBeGreaterThan(40);
    expect(tripViews([{ geo: [] }, { geo: [[1, 1]] }])).toEqual([]);
  });
});
