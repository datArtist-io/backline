// Flights: reading fares, choosing one, and booking with payment. All responses are synthetic.
import { describe, expect, it, vi } from "vitest";
import { DuffelClient, bestFlight, durationMinutes, flightOffersFrom, type FlightOffer } from "../src/clients/duffel";
import { flightOrigin, tripFlights } from "../src/skills/flights";
import { flightAction, tripExecute } from "../src/skills/trip";
import { normalizeTrip } from "../src/trip-request";
import { ctxWith } from "./helpers";

const seg = (from: string, to: string, dep: string, arr: string) => ({ origin: { iata_code: from }, destination: { iata_code: to }, departing_at: dep, arriving_at: arr, marketing_carrier: { name: "Air Peace", iata_code: "P4" }, marketing_carrier_flight_number: "7120" });
const offer = (id: string, amount: string, stops: number, duration: string) => ({
  id,
  total_amount: amount,
  total_currency: "NGN",
  owner: { name: stops ? "Connecting Air" : "Air Peace" },
  passengers: [{ id: "pas_1" }],
  slices: [{ origin: { iata_code: "LOS", name: "Murtala Muhammed" }, destination: { iata_code: "ABV", name: "Nnamdi Azikiwe" }, duration, segments: stops ? [seg("LOS", "ENU", "2026-11-14T07:00:00", "2026-11-14T08:00:00"), seg("ENU", "ABV", "2026-11-14T09:00:00", "2026-11-14T10:10:00")] : [seg("LOS", "ABV", "2026-11-14T08:00:00", "2026-11-14T09:15:00")] }],
});

describe("flight offers", () => {
  it("reads durations and offers", () => {
    expect(durationMinutes("PT1H15M")).toBe(75);
    expect(durationMinutes("P1DT2H")).toBe(1560);
    const offers = flightOffersFrom({ data: { offers: [offer("o2", "150000", 0, "PT1H15M"), offer("o1", "140000", 1, "PT3H10M")] } });
    expect(offers.map((o) => o.offerId)).toEqual(["o1", "o2"]);
    expect(offers[1].outbound).toMatchObject({ from: "LOS", to: "ABV", stops: 0, minutes: 75, flight: "P47120" });
  });

  it("chooses a sensible journey at the best price, direct when it costs little more", () => {
    const offers = flightOffersFrom({ data: { offers: [offer("slow", "100000", 1, "PT6H"), offer("direct", "110000", 0, "PT1H15M"), offer("pricey", "200000", 0, "PT1H10M")] } });
    expect(bestFlight(offers)?.offerId).toBe("direct");
    expect(bestFlight([])).toBeNull();
  });

  it("only looks for flights when the trip starts somewhere else and isn't by road", () => {
    const t = normalizeTrip({ destination: "Abuja, Nigeria", startDate: "2026-11-14" }, "Abuja")!;
    expect(flightOrigin(t, "Lagos")).toBe("Lagos");
    expect(flightOrigin({ ...t, origin: "Port Harcourt" }, "Lagos")).toBe("Port Harcourt");
    expect(flightOrigin(t, "Abuja")).toBeNull();
    expect(flightOrigin({ ...t, travelMode: "train" }, "Lagos")).toBeNull();
    expect(flightOrigin({ ...t, selfArranged: ["transport"] }, "Lagos")).toBeNull();
    expect(flightOrigin(t, undefined)).toBeNull();
  });
});

describe("booking a flight", () => {
  const f: FlightOffer = flightOffersFrom({ data: { offers: [offer("off_1", "150000", 0, "PT1H15M")] } })[0];
  const profile = { name: "Ada Obi", email: "ada@example.com", phone: "+2348012345678", birthDate: "1995-04-02", gender: "f" as const };

  it("asks for passport details it doesn't have", () => {
    expect(flightAction(f, { name: "Ada" }).missing).toMatch(/full name, email, phone, date of birth, gender/);
    expect(flightAction(f, profile).missing).toBeNull();
  });

  it("books and pays from the balance with the traveller's details", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { id: "ord_1", booking_reference: "RZPNX8", total_amount: "150000.00", total_currency: "NGN" } }) }));
    const flights = new DuffelClient({ token: "duffel_test_x", fetch: fetch as unknown as typeof globalThis.fetch });
    const trip = normalizeTrip({ destination: "Abuja, Nigeria", startDate: "2026-11-14", endDate: "2026-11-16", currency: "NGN" }, "Abuja")!;
    const action = { ...flightAction(f, profile), id: "a1" };
    const r = await tripExecute.run({ ...ctxWith(), flights }, { artist: "", trip, profile }, { "trip.actions": { data: { actions: [action] }, evidence: [] }, "trip.flights": { data: { flight: f, compared: 1, from: "Lagos", to: "Abuja", sandbox: true }, evidence: [] } });
    expect(r.data.results[0]).toMatchObject({ status: "booked", ref: "RZPNX8" });
    expect(r.data.results[0].message).toMatch(/Flight booked and paid: 150,000 NGN.*test airline/);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).data;
    expect(body.payments).toEqual([{ type: "balance", currency: "NGN", amount: "150000.00" }]);
    expect(body.passengers[0]).toMatchObject({ id: "pas_1", given_name: "Ada", family_name: "Obi", born_on: "1995-04-02", gender: "f", title: "ms" });
  });

  it("books with the saved passport, and asks for one when the airline needs it", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { id: "ord_2", booking_reference: "PSPT01", total_amount: "150000.00", total_currency: "NGN" } }) }));
    const flights = new DuffelClient({ token: "duffel_test_x", fetch: fetch as unknown as typeof globalThis.fetch });
    const intl = { ...f, documentsRequired: true };
    const trip = normalizeTrip({ destination: "Accra, Ghana", startDate: "2026-11-14", endDate: "2026-11-16", currency: "NGN" }, "Accra")!;
    const email = { name: "Ada", email: "ada@example.com", phone: "+2348012345678" };
    const deps = { "trip.actions": { data: { actions: [{ ...flightAction(intl, email, true), id: "a1" }] }, evidence: [] }, "trip.flights": { data: { flight: intl, compared: 1, from: "Lagos", to: "Accra", sandbox: true }, evidence: [] } };

    const without = await tripExecute.run({ ...ctxWith(), flights }, { artist: "", trip, profile: email }, deps);
    expect(without.data.results[0]).toMatchObject({ status: "needs_info" });
    expect(without.data.results[0].message).toMatch(/needs your passport/);
    expect(fetch).not.toHaveBeenCalled();

    const passport = { givenNames: "Adaeze", familyName: "Obi", number: "A12345678", nationality: "NG", issuingCountry: "NG", expiresOn: "2030-01-01", birthDate: "1995-04-02", gender: "f" as const };
    const withIt = await tripExecute.run({ ...ctxWith(), flights, traveller: { passport } }, { artist: "", trip, profile: email }, deps);
    expect(withIt.data.results[0]).toMatchObject({ status: "booked", ref: "PSPT01" });
    expect(JSON.stringify(withIt.data)).not.toContain("A12345678");
    const pax = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).data.passengers[0];
    expect(pax).toMatchObject({ given_name: "Adaeze", family_name: "Obi", born_on: "1995-04-02", identity_documents: [{ type: "passport", unique_identifier: "A12345678", issuing_country_code: "NG", expires_on: "2030-01-01" }] });
  });

  it("finds the flight for the trip", async () => {
    const flights = {
      sandbox: true,
      airport: vi.fn(async (q: string) => (/lagos/i.test(q) ? { code: "LOS", name: "Lagos" } : { code: "ABV", name: "Abuja" })),
      search: vi.fn(async () => [f]),
    } as unknown as DuffelClient;
    const trip = normalizeTrip({ destination: "Abuja, Nigeria", startDate: "2026-11-14", endDate: "2026-11-16" }, "Abuja")!;
    const r = await tripFlights.run({ ...ctxWith(), flights }, { artist: "", trip, profile: { homeCity: "Lagos" } }, {});
    expect(r.data.flight?.offerId).toBe("off_1");
    expect((flights.search as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ from: "LOS", to: "ABV", depart: "2026-11-14", back: "2026-11-16" });
  });
});
