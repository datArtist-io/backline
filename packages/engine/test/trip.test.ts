import { describe, expect, it, vi } from "vitest";
import { normalizeTrip } from "../src/missions";
import { bookingLink, buildActions, callInstructions, countryCodeFor, scorePlace, templatePlan, toPlace, tripDates, tripExecute, type Place } from "../src/skills/trip";
import { searchNear } from "../src/skills/places";
import { toE164 } from "../src/clients/calls";
import type { TripRequest } from "../src/types";
import { ctxWith, entity, stubQloo } from "./helpers";

const TODAY = "2026-10-22";
const trip = (over: Partial<TripRequest> = {}): TripRequest => ({
  destination: "Lagos, Nigeria",
  startDate: "2026-10-30",
  endDate: "2026-11-01",
  adults: 4,
  rooms: 2,
  budget: { amount: 2000000, currency: "NGN", scope: "total" },
  priceTier: 3,
  purpose: null,
  event: { type: "birthday dinner", guests: 8, date: "2026-10-31" },
  needs: ["stay", "dine"],
  near: null,
  travelMode: null,
  selfArranged: [],
  assumptions: [],
  ...over,
});
const place = (id: string, over: Partial<Place> = {}): Place => ({ ...toPlace(entity({ id, name: `Place ${id}`, type: "urn:entity:place" })), ...over });

describe("trip requests", () => {
  it("fills gaps with stated assumptions", () => {
    const t = normalizeTrip({ destination: "Accra", startDate: "2026-11-05" }, null, {}, TODAY)!;
    expect(t).toMatchObject({ destination: "Accra", startDate: "2026-11-05", endDate: "2026-11-07", adults: 1, rooms: 1, priceTier: 2 });
    expect(t.budget.currency).toBe("GHS");
    expect(t.assumptions.join(" ")).toContain("2-night");
  });

  it("drops past dates and adds a venue for hosted events", () => {
    const t = normalizeTrip({ destination: "Lagos", startDate: "2020-01-01", eventType: "launch party", eventGuests: 120, adults: 2 }, null, { budgetStyle: "luxury" }, TODAY)!;
    expect(t.startDate).toBeNull();
    expect(t.needs).toContain("venue");
    expect(t.priceTier).toBe(4);
  });

  it("needs a destination", () => {
    expect(normalizeTrip({}, null, {}, TODAY)).toBeNull();
  });

  it("lists every date of the trip", () => {
    expect(tripDates("2026-10-30", "2026-11-01")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(tripDates(null, null)).toEqual([]);
  });
});

describe("places", () => {
  it("scores budget fit, rating and taste", () => {
    const cheap = scorePlace(place("a", { priceLevel: 1, rating: 4.5, affinity: 0.8, match: 0.9 }), { priceTier: 3, tasteBased: true });
    const right = scorePlace(place("b", { priceLevel: 3, rating: 4.5, affinity: 0.8, match: 0.9 }), { priceTier: 3, tasteBased: true });
    expect(right.fit).toBeGreaterThan(cheap.fit);
    expect(right.why).toContain("Fits your budget");
    expect(right.why).toContain("Matches your taste");
  });

  it("reads Qloo place properties safely", () => {
    const p = toPlace(entity({ id: "h", name: "Hotel", properties: { address: "1 Road", phone: "+234 801 234 5678", website: "javascript:alert(1)", price_level: 3, business_rating: "4.4" } }));
    expect(p).toMatchObject({ address: "1 Road", website: null, priceLevel: 3, rating: 4.4 });
  });

  it("finds hotels around a point with Qloo's hotel tag", async () => {
    const insights = vi.fn(async () => [entity({ id: "H1", name: "Grand Hotel", type: "urn:entity:place", location: { lat: 6.46, lon: 3.39 }, properties: { price_level: 3, business_rating: 4.6 } })]);
    const findTags = vi.fn(async () => [{ id: "urn:tag:category:place:hotel", name: "Hotel", type: "urn:tag:category:place", affinity: null }]);
    const res = await searchNear(ctxWith({ qloo: stubQloo({ insights, findTags }) }), { kind: "stay", anchor: { name: "Lagos", lat: 6.455, lon: 3.394 }, radiusKm: 5, signals: [], priceTier: 3, nearBonus: false });
    expect(res.places[0]).toMatchObject({ name: "Grand Hotel", kind: "stay" });
    expect((insights.mock.calls[0] as unknown[])[1]).toMatchObject({ filterTags: ["urn:tag:category:place:hotel"], near: { radiusKm: 5 } });
  });
});

describe("actions", () => {
  const stays = [place("h1", { name: "Grand Hotel", email: "res@grand.example" })];
  const dines = [place("r1", { name: "Supper Club", phone: "0801 234 5678" }), place("r2", { name: "Cafe", email: "hi@cafe.example" })];
  const plan = templatePlan(trip(), stays, dines, [], tripDates("2026-10-30", "2026-11-01"));

  it("pre-fills booking links with dates and guests", () => {
    const url = new URL(bookingLink("Grand Hotel", "Lagos", trip()));
    expect(url.searchParams.get("checkin")).toBe("2026-10-30");
    expect(url.searchParams.get("group_adults")).toBe("4");
    expect(url.searchParams.get("no_rooms")).toBe("2");
  });

  it("normalises local phone numbers using the destination", () => {
    expect(countryCodeFor("Lagos, Nigeria")).toBe("234");
    expect(toE164("0801 234 5678", "234")).toBe("+2348012345678");
    expect(toE164("not a number", "234")).toBeNull();
    expect(toE164("801", undefined)).toBeNull();
  });

  it("proposes link, email, calls and calendar, flagging missing contact details", () => {
    const actions = buildActions(trip(), plan, { stays, dines, venues: [] }, {}, { email: true, calls: true });
    const channels = actions.map((a) => a.channel);
    expect(channels).toContain("link");
    expect(channels).toContain("email");
    expect(channels).toContain("call");
    expect(channels[channels.length - 1]).toBe("calendar");
    expect(actions.find((a) => a.channel === "email")?.missing).toContain("name and email");
    expect(actions.find((a) => a.channel === "call")?.to).toBe("+2348012345678");
  });

  it("falls back to doing it yourself when sending isn't connected", () => {
    const actions = buildActions(trip(), plan, { stays, dines, venues: [] }, { name: "Ada", email: "ada@example.com" }, { email: false, calls: false });
    expect(actions.filter((a) => a.channel === "email" || a.channel === "call").every((a) => a.mode === "you")).toBe(true);
  });

  it("always discloses the AI caller and refuses payment", () => {
    const a = buildActions(trip(), plan, { stays, dines, venues: [] }, { name: "Ada" }, { email: true, calls: true }).find((x) => x.channel === "call")!;
    const text = callInstructions(a, "Ada");
    expect(text).toContain("AI assistant");
    expect(text).toContain("Never give or ask for card");
  });
});

describe("execution", () => {
  const profile = { name: "Ada", email: "ada@example.com", phone: "+2348000000000" };
  const actionsDeps = (actions: ReturnType<typeof buildActions>) => ({ "trip.actions": { data: { actions }, evidence: [] } });

  it("sends approved emails and starts approved calls, nothing else", async () => {
    const stays = [place("h1", { name: "Grand Hotel", email: "res@grand.example" })];
    const dines = [place("r1", { name: "Supper Club", phone: "+2348012345678" })];
    const plan = templatePlan(trip(), stays, dines, [], tripDates("2026-10-30", "2026-11-01"));
    const actions = buildActions(trip(), plan, { stays, dines, venues: [] }, profile, { email: true, calls: true });
    const email = { from: "agent@x.example", send: vi.fn(async () => ({ id: "em_1" })) };
    const calls = { start: vi.fn(async () => ({ id: "call_1" })), status: vi.fn() };
    const ctx = { ...ctxWith(), email, calls };
    const emailId = actions.find((a) => a.channel === "email")!.id;
    const res = await tripExecute.run(ctx, { artist: "", trip: trip(), profile, selections: { actions: [emailId] } }, actionsDeps(actions));
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(calls.start).toHaveBeenCalledTimes(0);
    expect(res.data.results).toEqual([{ actionId: emailId, status: "sent", ref: "em_1", message: "Sent to res@grand.example. Replies go to ada@example.com." }]);
  });

  it("holds back actions that need the user's details", async () => {
    const stays = [place("h1", { name: "Grand Hotel", email: "res@grand.example" })];
    const actions = buildActions(trip(), templatePlan(trip(), stays, [], [], []), { stays, dines: [], venues: [] }, {}, { email: true, calls: true });
    const email = { from: "agent@x.example", send: vi.fn(async () => ({ id: "x" })) };
    const res = await tripExecute.run({ ...ctxWith(), email }, { artist: "", trip: trip(), profile: {} }, actionsDeps(actions));
    expect(email.send).toHaveBeenCalledTimes(0);
    expect(res.data.results.find((r) => r.status === "needs_info")).toBeTruthy();
  });
});

describe("voice notes", () => {
  it("rejects a tidy version that dropped a number", async () => {
    const { keepsNumbers, tidyTranscript } = await import("../src/tidy");
    expect(keepsNumbers("budget is 45,000 for 4 people", "Budget: 45000. People: 4.")).toBe(true);
    expect(keepsNumbers("budget is 45,000 for 4 people", "Budget for a group.")).toBe(false);
    const { stubLlm } = await import("./helpers");
    const raw = "um so I want to go to Lagos with like 4 people and my budget is 45,000";
    expect(await tidyTranscript(stubLlm(() => ({ text: "Trip to Lagos." })), raw)).toBe(raw);
    expect(await tidyTranscript(stubLlm(() => ({ text: "Trip to Lagos for 4 people.\nBudget: 45,000." })), raw)).toBe("Trip to Lagos for 4 people.\nBudget: 45,000.");
  });
});

describe("staying close to the landmark", () => {
  it("keeps only places that are really within the radius, nearest scoring highest", async () => {
    const theatre = { name: "National Theatre", lat: 6.476, lon: 3.368 };
    const insights = vi.fn(async () => [
      entity({ id: "near", name: "Close Hotel", type: "urn:entity:place", location: { lat: 6.48, lon: 3.37 } }),
      entity({ id: "far", name: "Far Hotel", type: "urn:entity:place", location: { lat: 6.6, lon: 3.5 } }),
    ]);
    const findTags = vi.fn(async () => [{ id: "urn:tag:category:place:hotel", name: "Hotel", type: "urn:tag:category:place", affinity: null }]);
    const res = await searchNear(ctxWith({ qloo: stubQloo({ insights, findTags }) }), { kind: "stay", anchor: theatre, radiusKm: 3, signals: [], priceTier: 2, nearBonus: true });
    expect(res.places.map((p) => p.id)).toEqual(["near"]);
    expect(res.places[0].distanceKm).toBeLessThan(1);
    expect(res.places[0].why).toContain("Walking distance");
  });

  it("still answers from the map when Qloo fails, and says so", async () => {
    const osm = {
      nearby: vi.fn(async () => [{ id: "osm:n1", url: "https://www.openstreetmap.org/node/1", name: "Iganmu Suites", lat: 6.474, lon: 3.37, category: "hotel", tags: ["Hotel"], address: null, phone: "+234 801 000 0000", email: null, website: null, stars: 3, hours: null }]),
    };
    const qloo = stubQloo({ insights: vi.fn(async () => { throw new Error("down"); }), findTags: vi.fn(async () => []) });
    const res = await searchNear({ ...ctxWith({ qloo }), osm: osm as never }, { kind: "stay", anchor: { name: "National Theatre", lat: 6.476, lon: 3.368 }, radiusKm: 3, signals: [], priceTier: 2, nearBonus: true });
    expect(res.places[0]).toMatchObject({ name: "Iganmu Suites", source: "osm", priceLevel: 2 });
    expect(res.failures).toEqual(["Qloo"]);
  });
});
