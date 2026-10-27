import { describe, expect, it } from "vitest";
import { weekendDates } from "../src/trip-request";

// 2026-10-27 is a Tuesday; 2026-10-30 Friday; 2026-10-31 Saturday; 2026-11-01 Sunday.
describe("weekendDates", () => {
  it("puts a weekend on Friday to Sunday", () => {
    expect(weekendDates("Plan a weekend in Lisbon for 2", "2026-10-27")).toEqual({ startDate: "2026-10-30", endDate: "2026-11-01" });
    expect(weekendDates("this weekend in Rome", "2026-10-27")).toEqual({ startDate: "2026-10-30", endDate: "2026-11-01" });
    expect(weekendDates("next weekend in Rome", "2026-10-27")).toEqual({ startDate: "2026-10-30", endDate: "2026-11-01" });
  });
  it("handles being in the weekend already", () => {
    expect(weekendDates("this weekend", "2026-10-31")).toEqual({ startDate: "2026-10-31", endDate: "2026-11-01" });
    expect(weekendDates("a weekend away", "2026-11-01")).toEqual({ startDate: "2026-11-06", endDate: "2026-11-08" });
    expect(weekendDates("next weekend", "2026-10-30")).toEqual({ startDate: "2026-11-06", endDate: "2026-11-08" });
  });
  it("makes a long weekend Friday to Monday", () => {
    expect(weekendDates("a long weekend in Paris", "2026-10-27")).toEqual({ startDate: "2026-10-30", endDate: "2026-11-02" });
  });
  it("leaves explicit dates and non-weekends alone", () => {
    expect(weekendDates("the weekend of the 14th", "2026-10-27")).toBeNull();
    expect(weekendDates("a weekend in March", "2026-10-27")).toBeNull();
    expect(weekendDates("3 nights in Tokyo", "2026-10-27")).toBeNull();
  });
});
