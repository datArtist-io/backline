// Hotel lanes, ride fares and links. Synthetic places.
import { describe, expect, it } from "vitest";
import { parsePrice, scoreHotels, tierHotels } from "../src/skills/hotel-tiers";
import { rideFare, rideLinks } from "../src/skills/rides";
import { withLiveFares, withRides } from "../src/skills/trip-routes";
import { cheapestFare } from "../src/clients/uber";
import type { Place } from "../src/skills/places";

const hotel = (id: string, o: Partial<Place>): Place => ({ id, name: id, address: null, phone: null, email: null, website: null, priceLevel: null, rating: null, affinity: null, image: null, lat: 6.47, lon: 3.37, tags: [], fit: 0.5, why: [], priceNote: null, extra: null, sources: [], distanceKm: 1, kind: "stay", source: "qloo", ...o });

describe("hotel lanes", () => {
  it("reads nightly prices from research notes", () => {
    expect(parsePrice("₦45,000–60,000 per night", "USD")).toEqual({ low: 45000, high: 60000, currency: "NGN" });
    expect(parsePrice("from $120 a night", "NGN")).toEqual({ low: 120, high: 120, currency: "USD" });
    expect(parsePrice("rooms from 35k", "NGN")).toEqual({ low: 35000, high: 35000, currency: "NGN" });
    expect(parsePrice("₦300,000 total for 3 nights", "NGN")).toBeNull();
    expect(parsePrice("call for rates", "NGN")).toBeNull();
  });

  it("uses only prices that are really listed, with their source", () => {
    const listed = { perNight: 72000, currency: "NGN", total: 144000, url: "https://www.booking.com/hotel/ng/a.html", site: "booking.com", note: null };
    const s = scoreHotels([hotel("a", { rate: listed }), hotel("b", { priceNote: "₦90,000 per night" }), hotel("c", { priceLevel: 3 }), hotel("d", { rate: { ...listed, currency: "USD", perNight: 60, total: null } })], "NGN", 2);
    expect(s[0].price).toMatchObject({ perNight: 72000, basis: "listed", site: "booking.com" });
    expect(s[1].price).toMatchObject({ perNight: 90000, basis: "web" });
    expect(s[2].price).toBeNull();
    expect(s[3].price).toMatchObject({ currency: "USD", perNight: 60 });
  });

  it("puts hotels in lanes people understand", () => {
    const stays = [
      hotel("Budget Inn", { rating: 3.6, priceNote: "₦30,000 per night", distanceKm: 2.5 }),
      hotel("Smart Stay", { rating: 4.4, priceNote: "₦50,000 per night", distanceKm: 1.4 }),
      hotel("Grand Palace", { rating: 4.8, priceNote: "₦220,000 per night", distanceKm: 3, website: "https://g.example" }),
      hotel("Next Door", { rating: 3.9, priceNote: "₦65,000 per night", distanceKm: 0.3 }),
    ];
    const { tiers } = tierHotels(stays, { currency: "NGN", nights: 2, near: "National Theatre" });
    const lane = (id: string) => tiers.find((t) => t.id === id)!.picks[0].id;
    expect(tiers.map((t) => t.id)).toEqual(["premium", "closest", "value", "cheapest"]);
    expect(lane("cheapest")).toBe("Budget Inn");
    expect(lane("value")).toBe("Smart Stay");
    expect(lane("premium")).toBe("Grand Palace");
    expect(lane("closest")).toBe("Next Door");
    const value = tiers.find((t) => t.id === "value")!.picks[0];
    expect(value.why).toBe("rated 4.4 · 1.4 km from National Theatre");
    expect(value.price?.perNight).toBe(50000);
  });
});

describe("rides", () => {
  it("gives Lagos rides an honest fare range and walks short hops", () => {
    const f = rideFare(6, 15, "NG Lagos, Nigeria")!;
    expect(f).toMatchObject({ provider: "Bolt", currency: "NGN" });
    expect(f.low).toBe(1700);
    expect(f.high).toBeGreaterThan(f.low);
    expect(rideFare(6, 15, "Lisbon, Portugal")).toBeNull();
    const stops = [{ lat: 6.47, lon: 3.37, name: "Hotel" }, { lat: 6.48, lon: 3.38, name: "Theatre" }, { lat: 6.5, lon: 3.4, name: "Dinner" }];
    const legs = withRides([{ from: 0, to: 1, km: 0.8, minutes: 10, mode: "walk", estimated: false }, { from: 1, to: 2, km: 4, minutes: 12, mode: "drive", estimated: false }], stops, "NG Lagos");
    expect(legs[0].ride).toBeUndefined();
    expect(legs[1].ride?.low).toBeGreaterThan(0);
    expect(legs[1].links?.map((l) => l.label)).toEqual(["Open Bolt"]);
  });

  it("opens Uber with both ends filled in where Uber operates", () => {
    const links = rideLinks({ lat: 51.5, lon: -0.12 }, { lat: 51.51, lon: -0.1, name: "Dinner" }, "GB London");
    expect(links[1].url).toContain("dropoff%5Blatitude%5D=51.510000");
  });
});

import { checkRate, lastJson } from "../src/clients/claude-search";

describe("hotel prices from the web", () => {
  const urls = ["https://www.booking.com/hotel/ng/sharrylesh.html", "https://hotels.ng/hotel/123"];
  it("accepts a price only when it comes from a page the search returned", () => {
    const raw = lastJson('Searching… Found it.\n{"perNight": 38500, "currency": "ngn", "total": 77000, "url": "https://booking.com/hotel/ng/sharrylesh.html?x=1", "note": "Standard double"}');
    expect(checkRate(raw, urls)).toMatchObject({ perNight: 38500, currency: "NGN", total: 77000, site: "booking.com", url: urls[0] });
    expect(checkRate({ perNight: 38500, currency: "NGN", url: "https://made-up.example/price" }, urls)).toBeNull();
    expect(checkRate({ perNight: null, currency: "NGN", url: urls[0] }, urls)).toBeNull();
    expect(lastJson("no json here")).toBeNull();
  });
});

describe("live Uber fares", () => {
  const stops = [
    { lat: 51.5, lon: -0.12, name: "A" },
    { lat: 51.51, lon: -0.14, name: "B" },
  ];
  const leg = { from: 0, to: 1, mode: "ride" as const, km: 3, minutes: 12 };
  const ctxWith = (uber: unknown) => ({ uber }) as never;

  it("picks the cheapest product and skips incomplete ones", () => {
    expect(
      cheapestFare({ prices: [{ display_name: "Black", low_estimate: 20, high_estimate: 26, currency_code: "GBP" }, { display_name: "UberX", low_estimate: 9, high_estimate: 12, currency_code: "GBP" }, { display_name: "Odd", low_estimate: null, high_estimate: null, currency_code: "GBP" }] })
    ).toEqual({ low: 9, high: 12, currency: "GBP", product: "UberX" });
    expect(cheapestFare({ prices: [] })).toBeNull();
    expect(cheapestFare(null)).toBeNull();
  });

  it("replaces the estimate with Uber's price, labelled as Uber's", async () => {
    const uber = { estimate: async () => ({ low: 9, high: 12, currency: "GBP", product: "UberX" }) };
    const out = await withLiveFares(ctxWith(uber), [leg as never], stops, "GB London", { left: 5 });
    expect(out[0].ride).toMatchObject({ provider: "Uber", low: 9, high: 12, currency: "GBP" });
  });

  it("keeps the estimate when there's no Uber, none where it runs, or Uber fails", async () => {
    const base = [{ ...leg, ride: { provider: "Bolt", low: 1, high: 2, currency: "NGN", basis: "x" } } as never];
    expect(await withLiveFares(ctxWith(null), base, stops, "GB London", { left: 5 })).toEqual(base);
    const called = { n: 0 };
    const spy = { estimate: async () => (called.n++, null) };
    expect(await withLiveFares(ctxWith(spy), base, stops, "NG Lagos", { left: 5 })).toEqual(base);
    expect(called.n).toBe(0);
    const failing = { estimate: async () => { throw new Error("down"); } };
    expect(await withLiveFares(ctxWith(failing), base, stops, "GB London", { left: 5 })).toEqual(base);
    expect(await withLiveFares(ctxWith(spy), base, stops, "GB London", { left: 0 })).toEqual(base);
    expect(called.n).toBe(0);
  });

  it("only calls Uber for the legs it's allowed to", async () => {
    let n = 0;
    const uber = { estimate: async () => (n++, null) };
    await withLiveFares(ctxWith(uber), [leg, leg, leg] as never, stops, "GB London", { left: 2 });
    expect(n).toBe(2);
  });
});
