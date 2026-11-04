import { describe, expect, it } from "vitest";
import { knownAirports } from "../src/clients/airports";
import { googleFare } from "../src/skills/trip-travel";
import { normalizeTrip } from "../src/trip-request";
import { ctxWith } from "./helpers";

describe("airports for a fare", () => {
  it("knows the main cities' airports by name", () => {
    expect(knownAirports("Atlanta, GA")).toEqual(["ATL"]);
    expect(knownAirports("Singapore")).toEqual(["SIN"]);
    expect(knownAirports("São Paulo, Brazil")).toEqual(["GRU", "CGH"]);
    expect(knownAirports("Nowhereville")).toEqual([]);
  });
  it("asks Google Flights without the flight provider for a known city", async () => {
    const fare = async (q: { from: string }) => ({ total: q.from === "ATL" ? 2400 : 2200, currency: "USD", airline: "Delta", stops: 1, minutes: 1300, url: null });
    const ctx = { ...ctxWith(), googleFlights: { fare } } as never;
    const trip = normalizeTrip({ destination: "Singapore", origin: "Atlanta", startDate: "2026-12-10", endDate: "2026-12-16", adults: 2 }, "singapore", {}, "2026-11-04")!;
    const o = await googleFare(ctx, { artist: "", trip } as never, "Atlanta", "Singapore");
    expect(o).toMatchObject({ live: true, priceMin: 1200, returnPrice: 1100, site: "Google Flights" });
  });
  it("says why when a city's airport can't be found", async () => {
    const ctx = { ...ctxWith(), googleFlights: { fare: async () => null } } as never;
    const trip = normalizeTrip({ destination: "Singapore", origin: "Nowhereville", startDate: "2026-12-10", adults: 1 }, "singapore", {}, "2026-11-04")!;
    await expect(googleFare(ctx, { artist: "", trip } as never, "Nowhereville", "Singapore")).rejects.toThrow(/no airport found for Nowhereville/);
  });
});
