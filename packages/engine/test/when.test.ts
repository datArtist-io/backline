import { describe, expect, it } from "vitest";
import { easter, readTime, readWhen } from "../src/when";
import { planGoal } from "../src/missions";

const T = "2026-10-30"; // a Friday

describe("reading dates on the calendar", () => {
  it.each([
    ["Weekend in Lisbon, Nov 14 to 16", "2026-11-14", "2026-11-16"],
    ["Lisbon 28 Dec to 2 Jan", "2026-12-28", "2027-01-02"],
    ["14-16 November in Paris", "2026-11-14", "2026-11-16"],
    ["Dec 30 to Jan 3 in Accra", "2026-12-30", "2027-01-03"],
    ["Paris 2026-11-14 to 2026-11-20", "2026-11-14", "2026-11-20"],
    ["Rome 14/11 - 20/11", "2026-11-14", "2026-11-20"],
    ["Rome 11/14 to 11/20", "2026-11-14", "2026-11-20"],
    ["Accra on the 14th to the 20th", "2026-11-14", "2026-11-20"],
    ["Friday to Sunday in Abuja", "2026-10-30", "2026-11-01"],
    ["next Fri to Mon in Abuja", "2026-11-06", "2026-11-09"],
    ["Christmas in London", "2026-12-24", "2026-12-26"],
    ["New Year's Eve in Dubai", "2026-12-31", "2027-01-01"],
    ["Easter in Rome", "2027-03-26", "2027-03-29"],
    ["Thanksgiving in New York", "2026-11-26", "2026-11-29"],
    ["this weekend in Lagos", "2026-10-30", "2026-11-01"],
    ["next weekend in Abuja", "2026-11-06", "2026-11-08"],
  ])("%s", (text, start, end) => {
    expect(readWhen(text, T)).toMatchObject({ start, end });
  });

  it.each([
    ["dinner tomorrow in Lagos", "2026-10-31"],
    ["the day after tomorrow", "2026-11-01"],
    ["in 3 days", "2026-11-02"],
    ["in two weeks", "2026-11-13"],
    ["next week", "2026-11-02"],
    ["next month", "2026-11-01"],
    ["on Monday", "2026-11-02"],
    ["Paris, 14th of November 2026", "2026-11-14"],
    ["mid-December 5 nights in Nairobi", "2026-12-15"],
    ["late January in Tokyo", "2027-01-24"],
    ["on 3 Jan 2027", "2027-01-03"],
  ])("%s starts %s", (text, start) => {
    expect(readWhen(text, T).start).toBe(start);
  });

  it("goes by the date when the weekday is wrong, and says so", () => {
    const w = readWhen("Friday 14 Nov in Paris", T);
    expect(w.start).toBe("2026-11-14");
    expect(w.notes.join(" ")).toMatch(/Saturday, not a Friday/);
  });

  it("reads an ambiguous numeric date day first, and says so", () => {
    expect(readWhen("05/06 in Lagos", T)).toMatchObject({ start: "2027-06-05" });
    expect(readWhen("05/06 in New York", T, { dayFirst: false }).start).toBe("2027-05-06");
  });

  it("knows Easter", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
  });

  it("puts dates and lengths together", async () => {
    const t = (await planGoal(null, "trip to Paris Nov 14 for 5 nights", { today: T })).trip!;
    expect([t.startDate, t.endDate]).toEqual(["2026-11-14", "2026-11-19"]);
    const d = (await planGoal(null, "Dinner for 4 in Lagos tonight", { today: T })).trip!;
    expect([d.startDate, d.endDate]).toEqual(["2026-10-30", "2026-10-30"]);
  });
});

describe("reading times", () => {
  it.each([
    ["dinner at 8pm", "20:00"],
    ["table at 19:30", "19:30"],
    ["dinner at half past 7", "19:30"],
    ["quarter to 9 tonight", "20:45"],
    ["lunch at noon", "12:00"],
    ["drinks at midnight", "00:00"],
    ["dinner at 8", "20:00"],
    ["breakfast at 9", "09:00"],
  ])("%s → %s", (text, time) => {
    expect(readTime(text)).toBe(time);
  });
});
