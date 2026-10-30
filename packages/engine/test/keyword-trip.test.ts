import { describe, expect, it } from "vitest";
import { adultsIn, budgetIn, dateRangeIn, keywordPlan, likesIn, originIn } from "../src/missions";

// When the planning model is down, the keyword reader must still get what was plainly said.
const GOAL = "Weekend in Lisbon from London, Nov 14 to 16, budget 1500 pounds, we love fado and seafood";

describe("keyword trip reader (model down)", () => {
  it("reads the city they start from", () => {
    expect(originIn(GOAL)).toBe("London");
    expect(originIn("4 days in Paris from Abuja")).toBe("Abuja");
    expect(originIn("a weekend in Rome from the 5th")).toBeNull();
    expect(originIn("dinner in Ikeja tonight")).toBeNull();
  });
  it("reads a budget with its currency", () => {
    expect(budgetIn(GOAL)).toEqual({ amount: 1500, currency: "GBP", scope: "total" });
    expect(budgetIn("a trip to Tokyo under $3k")).toMatchObject({ amount: 3000, currency: "USD" });
    expect(budgetIn("Lagos weekend, ₦1.5m per night")).toMatchObject({ amount: 1_500_000, currency: "NGN", scope: "per_night" });
    expect(budgetIn("dinner for 4 on the 28th")).toBeNull();
  });
  it("reads how many are travelling", () => {
    expect(adultsIn(GOAL)).toBe(2);
    expect(adultsIn("dinner for 4 near Lekki")).toBe(4);
    expect(adultsIn("a trip for two")).toBe(2);
    expect(adultsIn("a weekend in Lisbon from London")).toBeNull();
  });
  it("reads a date range", () => {
    expect(dateRangeIn(GOAL, "2026-10-30")).toEqual({ startDate: "2026-11-14", endDate: "2026-11-16" });
    expect(dateRangeIn("14-16 November", "2026-10-30")).toEqual({ startDate: "2026-11-14", endDate: "2026-11-16" });
    expect(dateRangeIn("28 Dec to 2 Jan", "2026-10-30")).toEqual({ startDate: "2026-12-28", endDate: "2027-01-02" });
  });
  it("reads what 'we' love", () => {
    expect(likesIn(GOAL)).toEqual(["fado", "seafood"]);
  });
  it("puts it all in the trip", () => {
    const t = keywordPlan(GOAL).trip!;
    expect(t).toMatchObject({ destination: "Lisbon", origin: "London", adults: 2, likes: ["fado", "seafood"] });
    expect(t.budget).toMatchObject({ amount: 1500, currency: "GBP" });
    expect(t.endDate! > t.startDate!).toBe(true);
  });
});
