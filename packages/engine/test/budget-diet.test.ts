import { describe, expect, it } from "vitest";
import { dietaryIn, groundTrip } from "../src/trip-request";
import { dietOk } from "../src/skills/places";
import { fitBudget, flightEstimate, type TripAction } from "../src/skills/trip";

describe("food rules from the request", () => {
  it("reads them in plain words", () => {
    expect(dietaryIn("Italian and Korean food, no pork, no tourist traps")).toEqual(["no pork"]);
    expect(dietaryIn("we eat halal and one of us is vegetarian")).toEqual(["halal", "vegetarian"]);
    expect(dietaryIn("she has a peanut allergy")).toEqual(["nut allergy"]);
    expect(dietaryIn("we love pork belly")).toEqual([]);
    expect(groundTrip({ destination: "Singapore" }, "no pork please")?.dietary).toEqual(["no pork"]);
  });
  it("drops places built around what they don't eat, and keeps halal ones", () => {
    const pl = (name: string, tags: string[] = []) => ({ name, tags });
    expect(dietOk(pl("IPPUDO Mandarin Gallery", ["Ramen"]), ["no pork"])).toBe(false);
    expect(dietOk(pl("Morganfield's | Suntec City"), ["no pork"])).toBe(false);
    expect(dietOk(pl("Song Fa Bak Kut Teh"), ["halal"])).toBe(false);
    expect(dietOk(pl("Zam Zam Restaurant", ["Halal"]), ["no pork"])).toBe(true);
    expect(dietOk(pl("Da Paolo Pizza Bar", ["Italian"]), ["no pork"])).toBe(true);
    expect(dietOk(pl("Wolfgang's Steakhouse"), ["vegetarian"])).toBe(false);
    expect(dietOk(pl("IPPUDO"), [])).toBe(true);
  });
});

describe("money", () => {
  it("estimates long flights at a realistic price", () => {
    expect(flightEstimate(16024)).toBeGreaterThan(800);
    expect(flightEstimate(16024)).toBeLessThan(1000);
    expect(flightEstimate(1200)).toBeLessThan(200);
  });
  it("unticks optional extras, dearest tables first, to stay within budget, never flights or the stay", () => {
    const a = (kind: TripAction["kind"], total: number, placeName: string | null = null) => ({ id: placeName ?? kind, kind, channel: kind === "reserve_table" ? "call" : "reserve", title: kind, placeId: null, placeName, mode: "auto", recommended: true, price: { total, currency: "USD" } }) as unknown as TripAction;
    const acts = [a("book_travel", 3600), a("book_stay", 1600), a("book_rides", 500), a("reserve_table", 140, "PS.Cafe"), a("reserve_table", 70, "Zam Zam")];
    const trip = { budget: { amount: 5500, currency: "USD", scope: "total" } } as never;
    const r = fitBudget(acts, trip)!;
    expect(r.total).toBeLessThanOrEqual(5500);
    expect(r.trimmed[0]).toBe("PS.Cafe");
    expect(acts.find((x) => x.kind === "book_travel")!.recommended).toBe(true);
    expect(acts.find((x) => x.kind === "book_stay")!.recommended).toBe(true);
    expect(fitBudget(acts, { budget: { amount: null, currency: "USD", scope: null } } as never)).toBeNull();
  });
});

import { cuisinesOf } from "../src/skills/trip-agent";
describe("cuisines they ask for", () => {
  it("are read from what they love", () => {
    expect(cuisinesOf({ likes: ["Beyoncé", "jazz", "Italian food", "Korean food"], purpose: null })).toEqual(["italian", "korean"]);
    expect(cuisinesOf({ likes: [], purpose: null }, "a weekend in Rome, we love Nigerian and Thai")).toEqual(["nigerian", "thai"]);
  });
});
