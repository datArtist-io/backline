import { afterEach, describe, expect, it, vi } from "vitest";
import { memoriesFrom, mergeProfile, recentBooking, tripRecord } from "../src/lib/account";

const results = {
  "trip.agent": {
    data: {
      trip: { destination: "Abuja", startDate: "2026-11-14", endDate: "2026-11-16", likes: ["afrobeats"] },
      where: { city: { name: "Abuja", country: "Nigeria" } },
      picks: { stays: ["s1"] },
      stays: [{ id: "s1", name: "Test Hotel" }],
      summary: "Two nights in Abuja.",
    },
  },
  "trip.actions": { data: { actions: [{ id: "a1", title: "Book your stay at Test Hotel" }] } },
  "trip.execute": { data: { results: [{ actionId: "a1", status: "booked", ref: "ABC123", message: "Booked." }] } },
} as unknown as Parameters<typeof tripRecord>[2];

describe("mergeProfile", () => {
  it("keeps saved details, fills gaps from the browser and adds remembered tastes and places", () => {
    const p = mergeProfile({ name: "Ada", likes: ["jazz"] }, { name: "Someone else", homeCity: "Lagos" }, [
      { kind: "like", value: "Afrobeats" },
      { kind: "stayed", value: "Test Hotel, Abuja" },
    ]);
    expect(p.name).toBe("Ada");
    expect(p.homeCity).toBe("Lagos");
    expect(p.likes).toEqual(["jazz", "Afrobeats"]);
    expect(p.notes).toContain("stayed at Test Hotel, Abuja");
  });
});

describe("tripRecord and memoriesFrom", () => {
  it("records the trip and remembers what was booked", () => {
    const r = tripRecord("Weekend in Abuja", "Weekend in Abuja", results);
    expect(r?.destination).toBe("Abuja, Nigeria");
    expect(r?.details.stay).toBe("Test Hotel");
    expect(r?.details.bookings[0]).toEqual({ title: "Book your stay at Test Hotel", status: "booked", ref: "ABC123", message: "Booked." });
    const mems = memoriesFrom(r!, { likes: ["afrobeats"] });
    expect(mems.map((m) => `${m.kind}:${m.value}`)).toEqual(["like:afrobeats", "visited:Abuja, Nigeria", "stayed:Test Hotel, Abuja"]);
  });

  it("skips missions that weren't trips", () => {
    expect(tripRecord("x", "x", {})).toBeNull();
  });
});

describe("recentBooking", () => {
  const session = { user: { id: "u1" }, accessToken: "tok", cfg: { url: "https://x.supabase.co", anonKey: "k" } } as unknown as Parameters<typeof recentBooking>[0];
  afterEach(() => vi.unstubAllGlobals());

  it("finds a recent booking for the same request", async () => {
    const rows = [
      { created_at: "2026-11-01T11:00:00Z", details: { bookings: [{ title: "Hotel", status: "failed", ref: null, message: "" }] } },
      { created_at: "2026-11-01T10:00:00Z", details: { bookings: [{ title: "Hotel", status: "booked", ref: "HC9", message: "" }] } },
    ];
    const f = vi.fn(async () => new Response(JSON.stringify(rows)));
    vi.stubGlobal("fetch", f);
    expect(await recentBooking(session, "Weekend in Abuja")).toEqual({ at: "2026-11-01T10:00:00Z", refs: ["HC9"] });
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("goal=eq.Weekend%20in%20Abuja");
    expect(url).toContain("created_at=gte.");
  });

  it("finds nothing when nothing was booked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]")));
    expect(await recentBooking(session, "Weekend in Abuja")).toBeNull();
  });
});
