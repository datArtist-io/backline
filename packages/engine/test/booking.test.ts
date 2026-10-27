// Live hotel rates and paying for a booking. All responses are synthetic.
import { describe, expect, it, vi } from "vitest";
import { LiteApiProvider, bookingFrom, cancellationText, offersFrom } from "../src/clients/liteapi";
import { attachOffers } from "../src/skills/places";
import { tripActions, tripExecute } from "../src/skills/trip";
import type { BriefInput } from "../src/types";
import { normalizeTrip } from "../src/trip-request";
import type { HotelProvider } from "../src/clients/hotels";
import { ctxWith } from "./helpers";
import { UpstreamError } from "../src/errors";

const RATES = {
  data: [
    {
      hotelId: "lp1",
      roomTypes: [
        { offerId: "off-dear", offerRetailRate: { amount: 300000, currency: "NGN" }, rates: [{ name: "Suite", boardName: "Breakfast included", cancellationPolicies: { refundableTag: "RFN", cancelPolicyInfos: [{ cancelTime: "2026-11-12 12:00:00" }] } }] },
        { offerId: "off-cheap", offerRetailRate: { amount: 180000, currency: "NGN" }, rates: [{ name: "Standard room", boardName: "Room only", cancellationPolicies: { refundableTag: "NRFN" } }] },
      ],
    },
    { hotelId: "lp2", roomTypes: [{ offerId: "off-2", rates: [{ name: "Deluxe", retailRate: { total: [{ amount: 240000, currency: "NGN" }] } }] }] },
  ],
  hotels: [
    { id: "lp1", name: "Eko Hotel And Suites", latitude: 6.4253, longitude: 3.4304, rating: 8.6, stars: 5 },
    { id: "lp2", name: "Lagos Continental Hotel", latitude: 6.4285, longitude: 3.4227, rating: 4.2, stars: 4 },
  ],
};

describe("LiteAPI offers", () => {
  it("keeps the cheapest rate per hotel, with cancellation terms and a nightly price", () => {
    const offers = offersFrom(RATES, { checkin: "2026-11-14", checkout: "2026-11-16", currency: "NGN" });
    expect(offers.map((o) => [o.name, o.offerId, o.total, o.perNight])).toEqual([
      ["Eko Hotel And Suites", "off-cheap", 180000, 90000],
      ["Lagos Continental Hotel", "off-2", 240000, 120000],
    ]);
    expect(offers[0].refundable).toBe(false);
    expect(offers[0].cancellation).toBe("Non-refundable");
  });

  it("reads cancellation terms and bookings", () => {
    expect(cancellationText({ refundableTag: "RFN", cancelPolicyInfos: [{ cancelTime: "2026-11-12 12:00:00" }] }).text).toBe("Free cancellation until 2026-11-12");
    expect(bookingFrom({ bookingId: "B1", status: "CONFIRMED", hotelConfirmationCode: "HC9", price: 180000, currency: "NGN" })).toMatchObject({ status: "confirmed", reference: "HC9", total: 180000 });
  });

  it("joins offers onto hotels already found and adds the rest", () => {
    const offers = offersFrom(RATES, { checkin: "2026-11-14", checkout: "2026-11-16", currency: "NGN" });
    const found = [{ id: "q1", name: "Eko Hotel & Suites", address: null, phone: "+234 1", email: null, website: null, priceLevel: 4, rating: 4.5, affinity: 0.98, image: null, lat: 6.4254, lon: 3.4305, tags: [], fit: 0.8, why: [], priceNote: null, extra: null, sources: [] }];
    const out = attachOffers(found, offers, "LiteAPI");
    expect(out).toHaveLength(2);
    expect(out[0].offer?.offerId).toBe("off-cheap");
    expect(out[0].phone).toBe("+234 1");
    expect(out[1]).toMatchObject({ id: "hotels:lp2", source: "hotels" });
  });

  it("knows a sandbox key and sends the account payment method when paying", async () => {
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(/prebook/.test(url) ? { data: { prebookId: "P1", price: 180000, currency: "NGN" } } : { data: { bookingId: "B1", status: "CONFIRMED", price: 180000, currency: "NGN" } }),
    }));
    const p = new LiteApiProvider({ apiKey: "sand_test", fetch: fetch as unknown as typeof globalThis.fetch });
    expect(p.sandbox).toBe(true);
    const held = await p.hold("off-cheap", null);
    const booking = await p.pay(held.holdId, { firstName: "Ada", lastName: "Obi", email: "ada@example.com" });
    expect(booking.status).toBe("confirmed");
    const body = JSON.parse((fetch.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(body.payment).toEqual({ method: "ACC_CREDIT_CARD" });
    expect(body.prebookId).toBe("P1");
  });
});

describe("booking and paying", () => {
  const action = { id: "a1", kind: "book_stay", channel: "reserve", title: "Book and pay", placeId: "q1", placeName: "Eko Hotel", to: null, url: null, subject: null, body: null, callOpening: null, callBrief: null, missing: null, offerId: "off-cheap", price: { total: 180000, currency: "NGN" }, mode: "auto", recommended: true };
  const provider = (total: number): HotelProvider => ({
    name: "LiteAPI",
    sandbox: true,
    search: vi.fn(),
    hold: vi.fn(async () => ({ holdId: "P1", offerId: "off-cheap", total, currency: "NGN", cancellation: "Non-refundable", checkoutUrl: null, checkout: null })),
    pay: vi.fn(async () => ({ bookingId: "B1", status: "confirmed" as const, hotelName: "Eko Hotel", checkin: null, checkout: null, total, currency: "NGN", reference: "HC9" })),
    confirm: vi.fn(),
  });
  const run = (hotels: HotelProvider, budget: number | null) =>
    tripExecute.run(
      { ...ctxWith(), hotels },
      { artist: "", trip: normalizeTrip({ destination: "Lagos, Nigeria", startDate: "2026-11-14", endDate: "2026-11-16", budgetAmount: budget, currency: "NGN" }, "Lagos")!, profile: { name: "Ada Obi", email: "ada@example.com" } },
      { "trip.actions": { data: { actions: [action] }, evidence: [] } }
    );

  it("books and pays when the price matches and fits the budget", async () => {
    const hotels = provider(180000);
    const r = await run(hotels, 500000);
    expect(r.data.results[0]).toMatchObject({ status: "booked", ref: "HC9" });
    expect(r.data.results[0].message).toMatch(/Booked and paid: 180,000 NGN, confirmation HC9/);
  });

  it("doesn't pay when the price went up or is over budget", async () => {
    const pricier = provider(260000);
    expect((await run(pricier, null)).data.results[0].status).toBe("needs_info");
    expect(pricier.pay).not.toHaveBeenCalled();
    const over = provider(180000);
    expect((await run(over, 150000)).data.results[0]).toMatchObject({ status: "needs_info" });
    expect(over.pay).not.toHaveBeenCalled();
  });

  it("books the next best hotel when the chosen room has sold out", async () => {
    const hotels = provider(200000);
    hotels.hold = vi.fn(async (offerId: string) => {
      if (offerId === "off-cheap") throw new UpstreamError("hotels", 400, "LiteAPI returned 400: no availability found", "The hotel couldn't be booked: no availability found");
      return { holdId: "P2", offerId, total: 200000, currency: "NGN", cancellation: null, checkoutUrl: null, checkout: null };
    });
    const stay = (id: string, name: string, offerId: string, fit: number) => ({ id, name, fit, offer: { offerId, total: 200000, currency: "NGN" } });
    const r = await tripExecute.run(
      { ...ctxWith(), hotels },
      { artist: "", trip: normalizeTrip({ destination: "Lagos, Nigeria", startDate: "2026-11-14", endDate: "2026-11-16", currency: "NGN" }, "Lagos")!, profile: { name: "Ada Obi", email: "ada@example.com" } },
      { "trip.actions": { data: { actions: [action] }, evidence: [] }, "trip.agent": { data: { stays: [stay("q2", "Lagos Continental", "off-2", 0.8)] }, evidence: [] } } as never
    );
    expect(r.data.results[0]).toMatchObject({ status: "booked" });
    expect(r.data.results[0].message).toMatch(/Eko Hotel had no rooms left, so I booked Lagos Continental instead/);
  });
});

describe("never paying wrongly", () => {
  const action = { id: "a1", kind: "book_stay", channel: "reserve", title: "Book and pay", placeId: "q1", placeName: "Eko Hotel", to: null, url: null, subject: null, body: null, callOpening: null, callBrief: null, missing: null, offerId: "off-cheap", price: { total: 180000, currency: "NGN" }, mode: "auto", recommended: true };
  const provider = (total = 180000): HotelProvider => ({
    name: "LiteAPI",
    sandbox: true,
    search: vi.fn(),
    hold: vi.fn(async () => ({ holdId: "P1", offerId: "off-cheap", total, currency: "NGN", cancellation: null, checkoutUrl: null, checkout: null })),
    pay: vi.fn(async () => ({ bookingId: "B1", status: "confirmed" as const, hotelName: "Eko Hotel", checkin: null, checkout: null, total, currency: "NGN", reference: "HC9" })),
    confirm: vi.fn(),
  });
  const runWith = (hotels: HotelProvider, extra: Partial<BriefInput> = {}, tripRaw: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) =>
    tripExecute.run(
      { ...ctxWith(), hotels },
      { artist: "", trip: normalizeTrip({ destination: "Lagos, Nigeria", startDate: "2026-11-14", endDate: "2026-11-16", currency: "NGN", ...tripRaw }, "Lagos")!, profile: { name: "Ada Obi", email: "ada@example.com" }, ...extra },
      { "trip.actions": { data: { actions: [action] }, evidence: [] }, ...deps } as never
    );

  it("doesn't pay for a swapped hotel that costs much more than the one approved", async () => {
    const hotels = provider();
    hotels.hold = vi.fn(async (offerId: string) => {
      if (offerId === "off-cheap") throw new UpstreamError("hotels", 400, "LiteAPI returned 400: no availability found", "The hotel couldn't be booked: no availability found");
      return { holdId: "P2", offerId, total: 300000, currency: "NGN", cancellation: null, checkoutUrl: null, checkout: null };
    });
    const stay = { id: "q2", name: "Lagos Continental", fit: 0.8, offer: { offerId: "off-2", total: 300000, currency: "NGN" } };
    const r = await runWith(hotels, {}, {}, { "trip.agent": { data: { stays: [stay] }, evidence: [] } });
    expect(r.data.results[0].status).toBe("needs_info");
    expect(r.data.results[0].message).toMatch(/Eko Hotel had no rooms left.*price is now 300,000 NGN/);
    expect(hotels.pay).not.toHaveBeenCalled();
  });

  it("doesn't book the same request twice", async () => {
    const hotels = provider();
    const r = await runWith(hotels, { alreadyBooked: { at: "2026-11-01T10:00:00Z", refs: ["HC9"] } });
    expect(r.data.results[0]).toMatchObject({ status: "needs_info" });
    expect(r.data.results[0].message).toMatch(/already booked on 1 Nov.*HC9.*Run again/);
    expect(hotels.hold).not.toHaveBeenCalled();
    expect(hotels.pay).not.toHaveBeenCalled();
  });

  it("books a room automatically only for one room", async () => {
    const hotels = provider();
    const r = await runWith(hotels, {}, { adults: 3, rooms: 2 });
    expect(r.data.results[0]).toMatchObject({ status: "needs_info" });
    expect(r.data.results[0].message).toMatch(/2 rooms/);
    expect(hotels.hold).not.toHaveBeenCalled();
  });

  it("says plainly when nobody is signed in", async () => {
    const trip = normalizeTrip({ destination: "Lagos, Nigeria", startDate: "2026-11-14", endDate: "2026-11-16" }, "Lagos")!;
    const agent = { trip, where: { city: null, landmark: null }, stays: [], dines: [], venues: [] };
    const plan = { summary: "", stayId: null, venueId: null, days: [], budget: [], tips: [], method: "template" };
    const r = await tripActions.run({ ...ctxWith(), signedOut: true }, { artist: "", trip, profile: {} }, { "trip.agent": { data: agent, evidence: [] }, "trip.plan": { data: plan, evidence: [] } } as never);
    expect(r.notes?.[0]).toMatch(/Sign in and I'll book/);
  });
});

describe("calls fail closed", () => {
  const action = {
    id: "a1", kind: "reserve_table", channel: "call", title: "Call Z Kitchen", placeId: "D1", placeName: "Z Kitchen", to: "+2349064222222",
    callOpening: "Hello", callBrief: "Book a table", mode: "auto", recommended: true, missing: null,
  } as never;
  const trip = normalizeTrip({ destination: "Lagos, Nigeria", startDate: "2026-10-30", endDate: "2026-10-30" }, "Lagos")!;
  const deps = { "trip.actions": { data: { actions: [action] }, evidence: [] } };
  const caller = () => ({ start: vi.fn(async () => ({ id: "call-1" })), status: vi.fn() });

  it("never dials a business without a demo line or live calling switched on", async () => {
    const calls = caller();
    const r = await tripExecute.run({ ...ctxWith(), calls, callDemoTo: null, callsLive: false } as never, { artist: "", trip, profile: { name: "Ada", email: "ada@example.com" } }, deps);
    expect(calls.start).not.toHaveBeenCalled();
    expect(r.data.results[0].status).toBe("needs_info");
  });
  it("rings the demo line instead of the business", async () => {
    const calls = caller();
    await tripExecute.run({ ...ctxWith(), calls, callDemoTo: "+2348000000000", callsLive: false } as never, { artist: "", trip, profile: { name: "Ada", email: "ada@example.com" } }, deps);
    expect(calls.start).toHaveBeenCalledWith(expect.objectContaining({ to: "+2348000000000" }), undefined);
  });
  it("dials the business only when live calling is on and no demo line is set", async () => {
    const calls = caller();
    await tripExecute.run({ ...ctxWith(), calls, callDemoTo: null, callsLive: true } as never, { artist: "", trip, profile: { name: "Ada", email: "ada@example.com" } }, deps);
    expect(calls.start).toHaveBeenCalledWith(expect.objectContaining({ to: "+2349064222222" }), undefined);
  });
});

import { callOutcome } from "../src/clients/calls";
describe("call outcomes", () => {
  it("reads what happened on a call", () => {
    expect(callOutcome("in-progress", null, null)).toBe("live");
    expect(callOutcome("ended", "call.in-progress.error-assistant-did-not-receive-customer-audio", null)).toBe("no_audio");
    expect(callOutcome("ended", "customer-did-not-answer", null)).toBe("no_answer");
    expect(callOutcome("ended", "customer-busy", null)).toBe("busy");
    expect(callOutcome("ended", "voicemail", null)).toBe("voicemail");
    expect(callOutcome("ended", "customer-ended-call", "AI: Hello\nUser: Yes, we have a table")).toBe("talked");
    expect(callOutcome("ended", "call.start.error-vapifault", null)).toBe("failed");
  });
});

import { bookingFrom as callBooking } from "../src/clients/calls";
describe("booking read from a call", () => {
  it("reads what was agreed", () => {
    expect(callBooking({ confirmed: true, date: "Friday 30 October", time: "8pm", partySize: 2, name: "Josiah", reference: "" })).toEqual({ confirmed: true, date: "Friday 30 October", time: "8pm", partySize: 2, name: "Josiah", reference: null, notes: null });
    expect(callBooking({ date: "x" })).toBeNull();
    expect(callBooking(undefined)).toBeNull();
  });
});

import { bookingRef } from "../src/skills/trip";
describe("booking references", () => {
  it("keeps real references and replaces placeholders with a stable Backline one", () => {
    expect(bookingRef("HC9", "x")).toBe("HC9");
    expect(bookingRef("test", "hold-1")).toMatch(/^BL-[A-Z2-9]{6}$/);
    expect(bookingRef("test", "hold-1")).toBe(bookingRef("TEST", "hold-1"));
    expect(bookingRef(null, "a")).not.toBe(bookingRef(null, "b"));
  });
});
