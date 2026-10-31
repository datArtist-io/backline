import { describe, expect, it } from "vitest";
import { dayLabel } from "../src/skills/trip";
import { isCountryHit, stayForBudget } from "../src/skills/trip-agent";
import { justAMeal, saidIn, statedNights } from "../src/trip-request";
import { guessLocation, statedTier } from "../src/missions";

describe("a plan that matches the prompt", () => {
  it("reads a week as 7 days, a month as 30, a year as 365", () => {
    expect(statedNights("a week in Bali")).toBe(6);
    expect(statedNights("a month in Nairobi")).toBe(29);
    expect(statedNights("a year in London")).toBe(364);
  });
  it("plans only the meal when only a meal was asked for", () => {
    expect(justAMeal("Dinner for 2 in Lagos this Saturday at 8pm")).toBe(true);
    expect(justAMeal("Lunch and a museum in Rome tomorrow")).toBe(false);
    expect(justAMeal("3 days in Paris")).toBe(false);
  });
  it("finds 'visit Kenya' without the model", () => {
    expect(guessLocation("I want to visit Kenya for a week")).toBe("Kenya");
    expect(guessLocation("visit my mum in Accra")).toBe("Accra");
  });
  it("matches names with commas word by word", () => {
    expect(saidIn("Find me affordable hotels in London.", "London, United Kingdom")).toBe(true);
  });
  it("keeps 'final day' for the last day only", () => {
    expect(dayLabel("Final Day Exploration", 6, 30)).toBe("Exploration");
    expect(dayLabel("Safari and Departure", 29, 30)).toBe("Safari and Departure");
    expect(dayLabel("Cultural start & coffee", 21, 30)).toBe("Cultural & coffee");
  });
});

describe("price level", () => {
  const trip = (tier: number, extra = {}) => ({ destination: "London", startDate: "2026-10-30", endDate: "2026-11-02", adults: 1, rooms: 1, budget: { amount: null, currency: "NGN", scope: null }, priceTier: tier, purpose: null, event: null, needs: ["stay"], near: null, travelMode: null, selfArranged: [], assumptions: ["No budget given, so I aimed mid-range"], ...extra }) as never;
  const stay = (id: string, total: number) => ({ id, name: id, rating: 4.3, offer: { offerId: "x", total, currency: "NGN", perNight: null, roomName: null, board: null, refundable: null, cancellation: null, provider: "liteapi" } }) as never;
  const stays = [stay("Shard", 2903719), stay("Westminster", 1092638), stay("Riverbank", 910534), stay("Hampton", 697991), stay("Wilde", 791642)];
  it("never books the dearest room on an affordable trip", () => {
    const r = stayForBudget(trip(1), "Shard", stays);
    expect(r?.id).not.toBe("Shard");
    expect(r?.reason).toMatch(/affordable/);
  });
  it("respects a nightly budget", () => {
    expect(stayForBudget(trip(2, { budget: { amount: 300000, currency: "NGN", scope: "per_night" } }), "Shard", stays)?.id).toBe("Hampton");
  });
  it("leaves a luxury pick alone", () => {
    expect(stayForBudget(trip(4), "Shard", stays)).toBeNull();
  });
  it("reads 'affordable' and 'luxury' from the request", () => {
    expect(statedTier(trip(2), "Find me affordable hotels in London").priceTier).toBe(1);
    expect(statedTier(trip(2), "a luxury weekend in Paris").priceTier).toBe(4);
  });
});

describe("countries", () => {
  it("knows a country hit from a city", () => {
    expect(isCountryHit({ name: "Kenya", country: "Kenya", kind: "country" })).toBe(true);
    expect(isCountryHit({ name: "Nairobi", country: "Kenya", kind: "city" })).toBe(false);
  });
});

import { planGoal } from "../src/missions";
describe("small talk", () => {
  it("answers 'hi' with what Backline does, even with a model that would read it as a music brief", async () => {
    const llm = { json: async () => ({ mission: "brief", artist: null, title: "Brief", language: "English", offTopic: false }) } as never;
    const p = await planGoal(llm, "hi", { today: "2026-10-31" });
    expect(p.offTopic).toBe(true);
    expect(p.reply).toBeTruthy();
  });
});

describe("open-ended places", () => {
  it("never takes a month for a place", () => {
    expect(guessLocation("I have 2 weeks off in December, surprise me")).toBeNull();
  });
  it("leaves the place open when they did, even if a model picked one", async () => {
    const llm = { json: async () => ({ mission: "plan", title: "Warm weekend", language: "English", offTopic: false, trip: { destination: "Lagos, Nigeria", needs: ["stay"] } }) } as never;
    expect((await planGoal(llm, "I want a relaxing weekend somewhere warm.", { today: "2026-10-31" })).trip).toBeNull();
    expect((await planGoal(llm, "Plan a weekend in Lagos", { today: "2026-10-31" })).trip?.destination).toMatch(/Lagos/);
  });
});

import { pinStatedDates } from "../src/trip-request";
describe("holidays with a length", () => {
  const base = { destination: "Dubai", startDate: "2026-12-31", endDate: "2027-01-01", adults: 1, rooms: 1, budget: { amount: null, currency: "USD", scope: null }, priceTier: 2, purpose: null, event: null, needs: ["stay"], near: null, travelMode: null, selfArranged: [], assumptions: [] } as never;
  it("New Year's Eve for 3 nights runs three nights from the 31st", () => {
    expect(pinStatedDates(base, "New Year's Eve in Dubai, 3 nights", "2026-10-31")).toMatchObject({ startDate: "2026-12-31", endDate: "2027-01-03" });
  });
  it("a fortnight is 14 days", () => {
    expect(statedNights("a fortnight in Bali starting Dec 3")).toBe(13);
    expect(pinStatedDates(base, "a fortnight in Bali starting Dec 3", "2026-10-31")).toMatchObject({ startDate: "2026-12-03", endDate: "2026-12-16" });
  });
});

import { childrenIn } from "../src/missions";
describe("children", () => {
  it("reads how many and how old", () => {
    expect(childrenIn("Family trip to Cape Town, 2 adults 2 kids")).toEqual({ ages: [8, 8], guessed: true });
    expect(childrenIn("with our children aged 5 and 9")).toEqual({ ages: [5, 9], guessed: false });
    expect(childrenIn("me, my wife and a baby")).toEqual({ ages: [1], guessed: true });
    expect(childrenIn("3 days in Paris")).toBeNull();
  });
});

import { extractJson } from "../src/clients/llm";
describe("model JSON slips", () => {
  it("mends a missing comma between items and a trailing comma", () => {
    const bad = '{"days":[{"label":"A","items":[{"time":"09:00","title":"x"}\n{"time":"10:00","title":"y"},]}]}';
    expect(extractJson(bad)).toEqual({ days: [{ label: "A", items: [{ time: "09:00", title: "x" }, { time: "10:00", title: "y" }] }] });
  });
  it("leaves valid JSON and strings with brackets alone", () => {
    expect(extractJson('{"note":"bring a hat }, really","n":[1,2]}')).toEqual({ note: "bring a hat }, really", n: [1, 2] });
  });
});
