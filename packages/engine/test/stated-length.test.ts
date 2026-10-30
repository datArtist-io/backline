import { describe, expect, it } from "vitest";
import { planGoal } from "../src/missions";
import { pinStatedDates, statedNights } from "../src/trip-request";

// The plan must be exactly what was asked: "2 days" is two days, not a long weekend.
const TODAY = "2026-10-30";

describe("trip length from the prompt", () => {
  it.each([
    ["plan a 2 days trip to angola", 1],
    ["3 nights in Dubai", 3],
    ["7 days in Paris", 6],
    ["a 7-day trip to Tokyo", 6],
    ["a week in Bali", 7],
    ["2 weeks in Thailand", 14],
    ["one day in Rome", 0],
    ["day trip to Ibadan", 0],
    ["overnight in Abuja", 1],
    ["dinner for 4 in Lagos tonight", 0],
    ["Lagos in 3 days time", null],
    ["Weekend in Lagos", null],
  ])("%s → %s nights", (text, nights) => {
    expect(statedNights(text)).toBe(nights);
  });

  it("plans exactly the days asked, even without dates", async () => {
    const t = (await planGoal(null, "plan a 2 days trip to angola", { today: TODAY })).trip!;
    expect([t.startDate, t.endDate]).toEqual(["2026-10-30", "2026-10-31"]);
    expect(t.assumptions.join(" ")).not.toMatch(/long weekend/);
  });

  it("pins an explicit range over whatever was chosen", () => {
    const t = { destination: "Lisbon", startDate: "2026-11-13", endDate: "2026-11-17", adults: 2, rooms: 1, budget: { amount: null, currency: "EUR", scope: null }, priceTier: 2, purpose: null, event: null, needs: ["stay", "dine"], near: null, travelMode: null, selfArranged: [], assumptions: [] } as never;
    expect(pinStatedDates(t, "Weekend in Lisbon, Nov 14 to 16", TODAY)).toMatchObject({ startDate: "2026-11-14", endDate: "2026-11-16" });
  });

  it("a day trip has no hotel but things to do", async () => {
    const t = (await planGoal(null, "one day in Rome", { today: TODAY })).trip!;
    expect(t.startDate).toBe(t.endDate);
    expect(t.needs).not.toContain("stay");
    expect(t.needs).toContain("activities");
  });
});

import { templatePlan, tripDates } from "../src/skills/trip";
import { normalizeTrip } from "../src/trip-request";
describe("long trips", () => {
  it("plans all 14 days of a 14-day trip", async () => {
    const t = (await planGoal(null, "plan a 14 days trip to Waterloo, Canada", { today: TODAY })).trip!;
    const dates = tripDates(t.startDate, t.endDate);
    expect(dates).toHaveLength(14);
    const trip = normalizeTrip({ destination: "Waterloo", startDate: dates[0], endDate: dates[13] }, null, {}, TODAY)!;
    const place = (id: string, kind: string) => ({ id, name: id, kind, lat: 43.46, lon: -80.52, address: null, rating: 4.5, priceLevel: 2, why: [], sources: [], source: "osm", fit: 1 }) as never;
    expect(templatePlan(trip, [place("s1", "stay")], [place("d1", "dine")], [], dates, { activities: [place("a1", "activity")] }).days).toHaveLength(14);
  });
});
