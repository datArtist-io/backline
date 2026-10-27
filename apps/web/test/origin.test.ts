import { describe, expect, it } from "vitest";
import { saidOrigin } from "../src/lib/origin";

describe("trip origin", () => {
  it("keeps a city the person named", () => {
    expect(saidOrigin("Abuja, Nigeria", "4 days in Paris from Abuja", null)).toBe(true);
    expect(saidOrigin("São Paulo", "a weekend in Lisbon from sao paulo", null)).toBe(true);
  });
  it("keeps their saved home city", () => {
    expect(saidOrigin("Lagos, Nigeria", "4 days in Paris", "Lagos")).toBe(true);
  });
  it("drops a city the model guessed", () => {
    expect(saidOrigin("Lagos, Nigeria", "4 days in Paris the way Pharrell would", null)).toBe(false);
  });
});
