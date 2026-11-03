import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFeed, feedToken, openFeedToken, subscribeLinks } from "../src/lib/calendar-feed";

const ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const trip = (over: Partial<Parameters<typeof buildFeed>[0][number]> = {}) => ({
  id: "t1",
  title: "Rome, 4 days",
  destination: "Rome, Italy",
  start_date: "2026-11-06",
  end_date: "2026-11-09",
  created_at: "2026-11-03T10:00:00Z",
  details: {
    bookings: [],
    budget: [],
    stay: null,
    flight: null,
    days: [{ date: "2026-11-06", label: "Arrival", items: [{ time: "09:00", title: "Arrive in Rome" }, { time: "12:00", title: "Lunch at Afrish" }, { time: "", title: "Wander Trastevere" }] }],
  },
  ...over,
});

describe("calendar feed", () => {
  const prev = process.env.RUN_SEAL_KEY;
  beforeEach(() => {
    process.env.RUN_SEAL_KEY = "test-key-that-is-long-enough";
  });
  afterEach(() => {
    process.env.RUN_SEAL_KEY = prev;
  });

  it("signs a link for one person and rejects forged ones", () => {
    const t = feedToken(ID)!;
    expect(openFeedToken(t)).toBe(ID);
    expect(openFeedToken(`${ID}.${"x".repeat(32)}`)).toBeNull();
    expect(openFeedToken(t.replace(ID, "2b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"))).toBeNull();
    expect(openFeedToken("nonsense")).toBeNull();
  });

  it("lists each stop as an event that lasts until the next one", () => {
    const ics = buildFeed([trip()], new Date("2026-11-03T12:00:00Z"));
    expect(ics).toContain("X-WR-CALNAME:Backline trips");
    expect(ics).toContain("SUMMARY:Arrive in Rome");
    expect(ics).toContain("DTSTART:20261106T090000");
    expect(ics).toContain("DTEND:20261106T120000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261106");
    expect(ics).toContain("LOCATION:Rome\\, Italy");
    expect(ics).toContain("UID:t1-0-0@backline");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });

  it("keeps only the newest plan for the same trip and drops old trips", () => {
    const older = trip({ id: "old", created_at: "2026-11-01T10:00:00Z" });
    const past = trip({ id: "past", destination: "Lagos", start_date: "2026-08-01", end_date: "2026-08-03" });
    const ics = buildFeed([older, trip(), past], new Date("2026-11-03T12:00:00Z"));
    expect(ics).toContain("UID:t1-0-0@backline");
    expect(ics).not.toContain("UID:old-");
    expect(ics).not.toContain("UID:past-");
  });

  it("subscribes Google and Apple to the same feed", () => {
    const l = subscribeLinks("https://backline.example/api/calendar/feed/abc.ics");
    expect(l.webcal).toBe("webcal://backline.example/api/calendar/feed/abc.ics");
    expect(l.google).toContain("calendar.google.com");
    expect(decodeURIComponent(l.google)).toContain("webcal://backline.example");
  });
});
