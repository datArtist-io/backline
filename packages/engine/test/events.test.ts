import { describe, expect, it } from "vitest";
import { monthsOf, shapeEvents } from "../src/skills/trip-events";

const page = (url: string) => ({ title: "Listings", url, content: "", publishedDate: null });

describe("events during the trip", () => {
  it("keeps only dated events inside the trip, from a source, best fit first then by date", () => {
    const sources = [page("https://www.ticketmaster.ca/a"), page("https://www.eventbrite.ca/b")];
    const raw = {
      events: [
        { name: "Afrobeats Night", kind: "concert", date: "2026-11-07", time: "21:00", venue: "History", fit: 0.95, source: "w1" },
        { name: "Too early", kind: "concert", date: "2026-10-01", source: "w1", fit: 0.9 },
        { name: "No source", kind: "festival", date: "2026-11-05", source: null, fit: 0.9 },
        { name: "No date", kind: "festival", date: null, source: "w2", fit: 0.9 },
        { name: "Winter Market", kind: "market", date: "2026-10-20", endDate: "2026-12-24", source: "w2", fit: 0.6 },
        { name: "Afrobeats Night", kind: "concert", date: "2026-11-07", source: "w2", fit: 0.9 },
      ],
    };
    const out = shapeEvents(raw, sources, "2026-10-30", "2026-11-19");
    expect(out.map((e) => e.name)).toEqual(["Winter Market", "Afrobeats Night"]);
    expect(out[0]).toMatchObject({ date: "2026-10-30", endDate: "2026-12-24", site: "eventbrite.ca", id: "e1" });
    expect(out[1]).toMatchObject({ time: "21:00", site: "ticketmaster.ca", fit: 0.95 });
  });
  it("names the months to search", () => {
    expect(monthsOf("2026-10-30", "2026-11-19")).toEqual(["October 2026", "November 2026"]);
    expect(monthsOf("2026-12-20", "2027-06-01")).toHaveLength(3);
  });
});
