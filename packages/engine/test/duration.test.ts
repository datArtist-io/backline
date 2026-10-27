import { describe, expect, it } from "vitest";
import { checkedDuration, hoursIn } from "../src/skills/trip-travel";

describe("flight times make sense for the distance", () => {
  it("reads hours", () => {
    expect(hoursIn("3 hours 30 minutes")).toBeCloseTo(3.5);
    expect(hoursIn("7–8 h")).toBeCloseTo(7.5);
  });
  it("replaces an impossible time with an estimate", () => {
    expect(checkedDuration("flight", "around 3 hours 30 minutes", 5837)).toMatch(/^about 7 h .*estimate/);
  });
  it("keeps a plausible one", () => {
    expect(checkedDuration("flight", "about 7 h 20 min", 5837)).toBe("about 7 h 20 min");
    expect(checkedDuration("train", "2 h", 450)).toBe("2 h");
  });
});
