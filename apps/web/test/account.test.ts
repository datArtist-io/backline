import { describe, expect, it } from "vitest";
import { memoriesFrom, mergeProfile, tripRecord } from "../src/lib/account";

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
