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

import { nameRefs } from "../src/skills/trip-agent";
describe("nameRefs", () => {
  const names = new Map([["d3", "Cafe Washington"], ["v2", "Teatro dell'Opera"]]);
  it("swaps ids for names without doubling a name that's already there", () => {
    expect(nameRefs("Lunch at Cafe Washington D3", names)).toBe("Lunch at Cafe Washington");
    expect(nameRefs("Lunch at D3", names)).toBe("Lunch at Cafe Washington");
    expect(nameRefs("See what's on at V2 tonight", names)).toBe("See what's on at Teatro dell'Opera tonight");
  });
});

import { dayDate } from "../src/trip-request";
describe("dayDate", () => {
  // 2026-10-27 is a Tuesday.
  it("resolves weekdays on the calendar", () => {
    expect(dayDate("Book dinner for 2 in Lagos this Friday at 8pm", "2026-10-27")).toBe("2026-10-30");
    expect(dayDate("dinner on saturday", "2026-10-27")).toBe("2026-10-31");
    expect(dayDate("lunch this Tuesday", "2026-10-27")).toBe("2026-10-27");
    expect(dayDate("lunch next Tuesday", "2026-10-27")).toBe("2026-11-03");
    expect(dayDate("drinks tonight", "2026-10-27")).toBe("2026-10-27");
    expect(dayDate("brunch tomorrow", "2026-10-27")).toBe("2026-10-28");
  });
  it("leaves explicit dates and weekends alone", () => {
    expect(dayDate("Friday 13th November", "2026-10-27")).toBeNull();
    expect(dayDate("this weekend in Rome", "2026-10-27")).toBeNull();
    expect(dayDate("a trip to Rome", "2026-10-27")).toBeNull();
  });
});

import { askedTime, holdAskedTime } from "../src/trip-request";
describe("asked time", () => {
  it("reads the time asked for", () => {
    expect(askedTime("Book dinner for 2 in Lagos this Friday at 8pm")).toBe("20:00");
    expect(askedTime("lunch at 12:30")).toBe("12:30");
    expect(askedTime("brunch 11.30 am")).toBe("11:30");
    expect(askedTime("dinner at 8 for 4")).toBe("20:00");
    expect(askedTime("dinner for 4 at 8 people")).toBeNull();
    expect(askedTime("a weekend in Rome")).toBeNull();
  });
  it("holds the meal at that time and keeps the day in order", () => {
    const days = [{ date: "2026-10-30", items: [
      { time: "18:00", title: "Walk on Adeola Odeku", placeId: null },
      { time: "19:30", title: "Dinner at Z Kitchen", placeId: "D1" },
      { time: "21:30", title: "Drinks nearby", placeId: null },
    ] }];
    const out = holdAskedTime(days, "Book dinner for 2 this Friday at 8pm", (id) => id === "D1");
    expect(out[0].items.map((i) => `${i.time} ${i.title}`)).toEqual(["18:00 Walk on Adeola Odeku", "20:00 Dinner at Z Kitchen", "21:30 Drinks nearby"]);
    expect(holdAskedTime(days, "Trip to Lagos, flight at 9am", () => true)).toBe(days);
  });
});

import { localOuting, normalizeTrip } from "../src/trip-request";
describe("local outing", () => {
  const trip = normalizeTrip({ destination: "Lagos, Nigeria", startDate: "2026-10-30", endDate: "2026-11-01", needs: ["stay", "dine"] }, "Lagos", {}, "2026-10-27")!;
  it("a dinner in your own city is one evening with no hotel", () => {
    const t = localOuting(trip, "Book dinner for 2 in Lagos this Friday at 8pm", "Lagos, Nigeria");
    expect(t.endDate).toBe("2026-10-30");
    expect(t.needs).not.toContain("stay");
  });
  it("leaves trips alone", () => {
    expect(localOuting(trip, "Weekend in Lagos with dinner", "Lagos")).toBe(trip);
    expect(localOuting(trip, "Book dinner in Lagos", "London")).toBe(trip);
  });
  it("puts the asked time on the asked day", () => {
    const days = [
      { date: "2026-10-30", items: [{ time: "18:30", title: "Early dinner nearby", placeId: null }] },
      { date: "2026-10-31", items: [{ time: "19:20", title: "Dinner at Glory's", placeId: "D1" }] },
    ];
    const out = holdAskedTime(days, "dinner this Friday at 8pm", (id) => id === "D1", "2026-10-31");
    expect(out[1].items[0].time).toBe("20:00");
  });
});
