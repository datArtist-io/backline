// The whole round trip: hotel availability by taste and budget, getting there and back, rides.
import { describe, expect, it, vi } from "vitest";
import { chooseStay, plannedActions, ridesAction, travelActions, tripExecute, withStayChoice } from "../src/skills/trip";
import { normalizeTrip } from "../src/trip-request";
import { ctxWith } from "./helpers";

const trip = normalizeTrip({ destination: "Rome, Italy", startDate: "2026-10-30", endDate: "2026-11-01", adults: 2 }, "Rome")!;
const place = (id: string, name: string, fit: number, offer?: { total: number; currency: string }) =>
  ({ id, name, kind: "stay", fit, match: fit, tags: [], why: [], lat: 41.9, lon: 12.5, source: "qloo", ...(offer ? { offer: { offerId: `o-${id}`, total: offer.total, currency: offer.currency, perNight: null, roomName: null, board: null, refundable: null, cancellation: null, provider: "liteapi" } } : {}) }) as never;

describe("hotel availability, by taste and budget", () => {
  it("keeps the planned hotel when it has rooms within budget", () => {
    const c = chooseStay([place("s1", "St. Regis", 0.87, { total: 900, currency: "EUR" }), place("s2", "Quirinale", 0.8, { total: 400, currency: "EUR" })], "s1", trip);
    expect(c.id).toBe("s1");
    expect(c.from).toBeNull();
    expect(c.checked).toBe(2);
  });
  it("swaps to the best available match when the planned hotel has no rooms", () => {
    const c = chooseStay([place("s1", "St. Regis", 0.87), place("s2", "Quirinale", 0.8, { total: 400, currency: "EUR" }), place("s3", "Budget Inn", 0.5, { total: 150, currency: "EUR" })], "s1", trip);
    expect(c.id).toBe("s2");
    expect(c.note).toMatch(/St\. Regis has no rooms listed/);
  });
  it("respects the budget", () => {
    const t = { ...trip, budget: { amount: 500, currency: "EUR", scope: "total" as const } };
    const c = chooseStay([place("s1", "St. Regis", 0.87, { total: 900, currency: "EUR" }), place("s2", "Quirinale", 0.8, { total: 450, currency: "EUR" })], "s1", t);
    expect(c.id).toBe("s2");
    expect(c.note).toMatch(/over your budget/);
  });
  it("keeps the plan when nothing has live availability (the agent confirms by phone)", () => {
    expect(chooseStay([place("s1", "St. Regis", 0.87)], "s1", trip)).toMatchObject({ id: "s1", from: null, checked: 0 });
  });
  it("rewrites the plan around the swapped hotel", () => {
    const plan = { summary: "Stay at St. Regis.", stayId: "s1", venueId: null, days: [{ date: null, label: "Arrive", items: [{ time: "15:00", title: "Check in at St. Regis", placeId: "s1", note: null }] }], budget: [], tips: [], method: "model" as const };
    const out = withStayChoice(plan, [place("s1", "St. Regis", 0.87), place("s2", "Quirinale", 0.8, { total: 400, currency: "EUR" })], trip);
    expect(out.stayId).toBe("s2");
    expect(out.days[0].items[0]).toMatchObject({ title: "Check in at Quirinale", placeId: "s2" });
    expect(out.summary).toBe("Stay at Quirinale.");
  });
});

describe("getting there and back", () => {
  const travel = {
    origin: "Lagos", destination: "Rome", km: 3990, from: null, to: null, gaps: [],
    options: [
      { mode: "flight", title: "Fly via Addis Ababa (Ethiopian)", duration: "about 11 h", priceMin: 600, priceMax: 800, currency: "USD", note: null, url: "https://example.com/a", site: "example.com", verified: true, best: true },
      { mode: "flight", title: "Fly via Istanbul (Turkish)", duration: "about 12 h", priceMin: 550, priceMax: 900, currency: "USD", note: null, url: null, site: null, verified: true, best: false },
    ],
  } as never;
  it("books the best option as two tickets, out and back, for everyone", () => {
    const [out, back] = travelActions(travel, trip, { pay: true });
    expect(out.title).toMatch(/out: Lagos → Rome/);
    expect(back.title).toMatch(/back: Rome → Lagos/);
    expect(out.price).toEqual({ total: 700 * 2, currency: "USD" });
    expect(back.price).toEqual({ total: 700 * 2, currency: "USD" });
    expect(out.options?.find((o) => o.best)?.title).toMatch(/Ethiopian/);
    expect(out.mode).toBe("auto");
  });
  it("estimates a long route's fare from distance when no source lists one, and says so", () => {
    const legs = travelActions({ ...(travel as object), options: [] } as never, trip, { pay: true });
    expect(legs).toHaveLength(2);
    expect(legs[0].subject).toMatch(/estimated from distance/);
    expect(legs[0].url).toMatch(/google\.com\/travel\/flights/);
  });
  it("offers nothing for a short route with no listed fare", () => {
    expect(travelActions({ ...(travel as object), km: 120, options: [] } as never, trip, { pay: true })).toEqual([]);
  });
});

describe("rides on the ground", () => {
  it("sets aside every ride, with a link to open each", () => {
    const routes = { days: [{ index: 0, date: null, label: "Day 1", stops: [{ name: "Airport" }, { name: "Hotel" }, { name: "Opera" }], legs: [{ from: 0, to: 1, km: 30, minutes: 40, mode: "drive", estimated: false, ride: { provider: "Uber", low: 40, high: 55, currency: "EUR", basis: "" }, links: [{ label: "Uber", url: "https://m.uber.com/ul/?x" }] }, { from: 1, to: 2, km: 0.6, minutes: 8, mode: "walk", estimated: false }], path: [], km: 30, minutes: 48, directions: null }] } as never;
    const a = ridesAction(routes, { pay: true })!;
    expect(a.rides).toHaveLength(1);
    expect(a.price).toEqual({ total: 55, currency: "EUR" });
    expect(a.rides![0].url).toMatch(/uber/);
  });
  it("is left out when there are no rides", () => {
    expect(ridesAction({ days: [] } as never, { pay: true })).toBeNull();
  });
  it("adds airport transfers both ways when the plan has none", () => {
    const a = ridesAction({ days: [{ index: 0, stops: [], legs: [] }, { index: 2, stops: [], legs: [] }] } as never, { pay: true }, { where: "Paris, France", hotel: "Hôtel Particulier", far: true })!;
    expect(a.rides!.map((x) => `${x.day}:${x.from}→${x.to}`)).toEqual(["0:Airport→Hôtel Particulier", "2:Hôtel Particulier→Airport"]);
    expect(a.rides![0].currency).toBe("EUR");
  });
});

describe("the rest of the planned spend", () => {
  const plan = { budget: [
    { item: "Hotel", amount: 900, currency: "EUR", basis: "" },
    { item: "Museum tickets", amount: 60, currency: "EUR", basis: "Louvre and Orsay" },
    { item: "Food and drinks", amount: 300, currency: "USD", basis: "" },
    { item: "Taxis", amount: 80, currency: "EUR", basis: "" },
  ] } as never;
  it("sets aside what no booking covers, without counting reserved meals twice", () => {
    const out = plannedActions(plan, [{ total: 70, currency: "USD" }, { total: 70, currency: "USD" }], { pay: true });
    expect(out.map((x) => [x.placeName, x.price?.total])).toEqual([["Museum tickets", 60], ["Food and drinks", 160]]);
  });
});

describe("paying for travel and rides", () => {
  it("prepays from the wallet with a receipt", async () => {
    const action = { id: "a1", kind: "book_travel", channel: "reserve", title: "Round-trip flights", placeId: null, placeName: "Ethiopian", to: null, url: null, subject: "Fly via Addis Ababa", body: null, callOpening: null, callBrief: null, mode: "auto", recommended: true, missing: null, price: { total: 2800, currency: "USD" }, options: [{ title: "x", mode: "flight", duration: null, price: null, site: "example.com", url: null, best: true }] } as never;
    const wallet = { hold: vi.fn(async () => ({ ok: true as const, id: "e9", usd: 280000 })), capture: vi.fn(async () => {}), release: vi.fn(async () => {}) };
    const r = await tripExecute.run({ ...ctxWith(), wallet } as never, { artist: "", trip, profile: { name: "Ada", email: "ada@example.com" } }, { "trip.actions": { data: { actions: [action] }, evidence: [] } } as never);
    expect(r.data.results[0]).toMatchObject({ status: "booked", paid: { entryId: "e9", total: 2800 } });
    expect(r.data.results[0].message).toMatch(/example\.com/);
  });
});
