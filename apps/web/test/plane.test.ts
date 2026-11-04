import { describe, expect, it } from "vitest";
import { easeHeading, planeHtml } from "../src/app/adventure/plane";

describe("the plane", () => {
  it("turns the short way round and never snaps", () => {
    expect(easeHeading(350, 10, 0.5)).toBeCloseTo(0);
    expect(easeHeading(10, 350, 0.5)).toBeCloseTo(0);
    expect(easeHeading(90, 90, 0.3)).toBe(90);
    expect(easeHeading(0, 180, 0)).toBe(0);
  });
  it("is the simple white jet with a shadow", () => {
    const h = planeHtml();
    expect(h).toContain("eq-plane-shadow");
    expect(h).toContain('fill="currentColor"');
  });
});
