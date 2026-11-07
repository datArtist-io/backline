// Property tests for the money rules (the bug-finding book, section 5.2, invariants M1 to M6). Each
// test states a law and fast-check tries hundreds of inputs, shrinking any failure to the smallest case.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { codeBudget, fitBudget, flightEstimate, travelActions, type TripAction } from "../../src/skills/trip";
import type { TripTravelOutput, TravelOption } from "../../src/skills/trip-travel";
import { blankTrip } from "../../src/trip-request";
import type { TripRequest } from "../../src";

const day = (d: number) => new Date(Date.UTC(2027, 2, 1 + d)).toISOString().slice(0, 10);

const arbTrip = fc
  .record({
    adults: fc.integer({ min: 1, max: 9 }),
    rooms: fc.integer({ min: 1, max: 4 }),
    nights: fc.integer({ min: 0, max: 40 }),
    tier: fc.integer({ min: 1, max: 4 }),
    budget: fc.option(fc.integer({ min: 1, max: 50_000 }), { nil: null }),
    needsDine: fc.boolean(),
  })
  .map(({ adults, rooms, nights, tier, budget, needsDine }): TripRequest => ({
    ...blankTrip(),
    destination: "Lisbon, Portugal",
    startDate: day(0),
    endDate: nights === 0 ? null : day(nights),
    adults,
    rooms,
    priceTier: tier as 1 | 2 | 3 | 4,
    budget: { amount: budget, currency: "USD", scope: budget ? "total" : null },
    needs: needsDine ? ["stay", "dine"] : ["stay"],
  }));

const arbOption = (live: boolean): fc.Arbitrary<TravelOption> =>
  fc.record({
    priceMin: fc.integer({ min: 20, max: 3000 }),
    spread: fc.integer({ min: 0, max: 500 }),
    returnPrice: fc.option(fc.integer({ min: 20, max: 3000 }), { nil: null }),
    best: fc.boolean(),
  }).map(({ priceMin, spread, returnPrice, best }) => ({
    mode: "flight" as const,
    title: live ? "Alaska + JAL" : "Flights listed on Skyscanner",
    duration: "about 9 h",
    priceMin,
    priceMax: priceMin + spread,
    currency: "USD",
    note: null,
    url: "https://example.test/fare",
    site: live ? null : "skyscanner.net",
    verified: true,
    best,
    live,
    returnPrice: live ? returnPrice : null,
  }));

const travelWith = (options: TravelOption[], km: number): TripTravelOutput => ({ origin: "Atlanta, United States", destination: "Singapore", km, from: { lat: 33.7, lon: -84.4 }, to: { lat: 1.3, lon: 103.8 }, options, gaps: [] });

describe("flightEstimate (M4: an estimate is a deterministic function of distance)", () => {
  it("is positive, whole, and never falls as the distance grows", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 20_000 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(flightEstimate(lo)).toBeGreaterThan(0);
        expect(Number.isInteger(flightEstimate(lo))).toBe(true);
        expect(flightEstimate(lo)).toBeLessThanOrEqual(flightEstimate(hi));
      }),
    );
  });
  it("stays within the range real fares fall in: $80 to about $1,300 one way", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000 }), (km) => {
        expect(flightEstimate(km)).toBeLessThanOrEqual(1400);
      }),
    );
  });
});

describe("travelActions (M4: live, then listed, then estimate; every leg says what it is)", () => {
  it("a live fare is charged as out + back per person, and is never called an estimate", () => {
    fc.assert(
      fc.property(arbTrip, arbOption(true), (trip, live) => {
        const legs = travelActions(travelWith([live], 15_000), trip, { pay: true });
        expect(legs.length).toBe(trip.endDate ? 2 : 1);
        const people = Math.max(1, trip.adults);
        expect(legs[0].price?.total).toBe(Math.round(live.priceMin! * people));
        if (legs[1]) expect(legs[1].price?.total).toBe(Math.round((live.returnPrice ?? live.priceMin!) * people));
        for (const l of legs) expect(`${l.subject ?? ""}`).not.toMatch(/estimat/i);
      }),
    );
  });
  it("with no live fare, a listed fare is used and labelled as listed, not live", () => {
    fc.assert(
      fc.property(arbTrip, arbOption(false), (trip, listed) => {
        const legs = travelActions(travelWith([listed], 15_000), trip, { pay: true });
        expect(legs.length).toBeGreaterThan(0);
        for (const l of legs) expect(l.subject).toMatch(/listed/i);
      }),
    );
  });
  it("with no fare at all on a long route, the estimate is labelled and equals flightEstimate × people", () => {
    fc.assert(
      fc.property(arbTrip, fc.integer({ min: 500, max: 20_000 }), (trip, km) => {
        const legs = travelActions(travelWith([], km), trip, { pay: true });
        expect(legs.length).toBeGreaterThan(0);
        for (const l of legs) {
          expect(l.subject).toMatch(/estimated/i);
          expect(l.price?.total).toBe(Math.round(flightEstimate(km) * Math.max(1, trip.adults)));
        }
      }),
    );
  });
  it("a live fare always wins over a listed one, whatever order they arrive in", () => {
    fc.assert(
      fc.property(arbTrip, arbOption(true), arbOption(false), fc.boolean(), (trip, live, listed, liveFirst) => {
        const legs = travelActions(travelWith(liveFirst ? [live, listed] : [listed, live], 15_000), trip, { pay: true });
        expect(legs[0].placeName).toBe(live.title);
        expect(legs[0].subject).not.toMatch(/listed/i);
      }),
    );
  });
  it("a short hop with no fare adds nothing to the slip (nothing invented)", () => {
    fc.assert(
      fc.property(arbTrip, fc.integer({ min: 0, max: 499 }), (trip, km) => {
        expect(travelActions(travelWith([], km), trip, { pay: true })).toEqual([]);
      }),
    );
  });
});

describe("codeBudget (M1: every amount computed, whole, and scaled by people and nights)", () => {
  it("amounts are whole, non-negative, and each line says its basis", () => {
    fc.assert(
      fc.property(arbTrip, fc.integer({ min: 0, max: 20_000 }), (trip, km) => {
        for (const line of codeBudget(trip, null, null, travelWith([], km))) {
          expect(Number.isInteger(line.amount)).toBe(true);
          expect(line.amount).toBeGreaterThanOrEqual(0);
          expect(line.basis.length).toBeGreaterThan(0);
        }
      }),
    );
  });
  it("doubling the travellers doubles food and the flight estimate", () => {
    fc.assert(
      fc.property(arbTrip.filter((t) => t.needs.includes("dine") && t.adults <= 4), fc.integer({ min: 500, max: 20_000 }), (trip, km) => {
        const one = codeBudget(trip, null, null, travelWith([], km));
        const two = codeBudget({ ...trip, adults: trip.adults * 2 }, null, null, travelWith([], km));
        const pick = (b: typeof one, re: RegExp) => b.find((l) => re.test(l.item))?.amount ?? 0;
        expect(pick(two, /Food/)).toBe(pick(one, /Food/) * 2);
        expect(pick(two, /Flights/)).toBe(pick(one, /Flights/) * 2);
      }),
    );
  });
  it("a flight line appears only when the trip is long-haul and travel is not self-arranged", () => {
    fc.assert(
      fc.property(arbTrip, fc.integer({ min: 0, max: 20_000 }), fc.boolean(), (trip, km, own) => {
        const t = own ? { ...trip, selfArranged: ["transport"] } : trip;
        const flights = codeBudget(t, null, null, travelWith([], km)).some((l) => /Flights/.test(l.item));
        expect(flights).toBe(!own && km >= 500);
      }),
    );
  });
});

describe("fitBudget (M2/M5: the slip never exceeds a budget silently)", () => {
  const arbAction = fc
    .record({
      kind: fc.constantFrom("book_flight", "reserve_table", "planned", "book_rides", "book_stay") as fc.Arbitrary<TripAction["kind"]>,
      total: fc.integer({ min: 1, max: 5000 }),
      auto: fc.boolean(),
      recommended: fc.boolean(),
      n: fc.integer({ min: 0, max: 1_000_000 }),
    })
    .map(({ kind, total, auto, recommended, n }): TripAction => ({
      id: `a${n}-${kind}-${total}`,
      kind,
      channel: "reserve",
      title: kind,
      placeId: null,
      placeName: `${kind} place`,
      to: null,
      url: null,
      subject: null,
      body: null,
      callOpening: null,
      callBrief: null,
      mode: auto ? "auto" : "you",
      recommended,
      missing: null,
      offerId: null,
      price: { total, currency: "USD" },
    }));

  const charged = (as: TripAction[]) => as.filter((a) => a.recommended && a.mode === "auto" && a.price?.currency === "USD").reduce((n, a) => n + a.price!.total, 0);

  it("after fitting, the charged total is within the budget, or only non-optional lines remain", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { minLength: 0, maxLength: 12 }), fc.integer({ min: 1, max: 20_000 }), (actions, amount) => {
        const trip: TripRequest = { ...blankTrip(), destination: "Lisbon", budget: { amount, currency: "USD", scope: "total" } };
        const copy = actions.map((a) => ({ ...a, price: a.price ? { ...a.price } : a.price }));
        const r = fitBudget(copy, trip);
        expect(r).not.toBeNull();
        expect(r!.total).toBeCloseTo(charged(copy), 2);
        const optionalLeft = copy.some((a) => ["reserve_table", "planned", "book_rides"].includes(a.kind) && a.recommended && a.mode === "auto");
        if (r!.total > amount) expect(optionalLeft).toBe(false);
      }),
    );
  });
  it("never unticks a flight or a stay, and never ticks anything that was unticked", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { minLength: 0, maxLength: 12 }), fc.integer({ min: 1, max: 20_000 }), (actions, amount) => {
        const trip: TripRequest = { ...blankTrip(), destination: "Lisbon", budget: { amount, currency: "USD", scope: "total" } };
        const before = actions.map((a) => ({ ...a }));
        const copy = actions.map((a) => ({ ...a }));
        fitBudget(copy, trip);
        copy.forEach((a, i) => {
          if (a.kind === "book_flight" || a.kind === "book_stay") expect(a.recommended).toBe(before[i].recommended);
          if (!before[i].recommended) expect(a.recommended).toBe(false);
        });
      }),
    );
  });
  it("is idempotent: fitting twice changes nothing more", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { minLength: 0, maxLength: 12 }), fc.integer({ min: 1, max: 20_000 }), (actions, amount) => {
        const trip: TripRequest = { ...blankTrip(), destination: "Lisbon", budget: { amount, currency: "USD", scope: "total" } };
        const copy = actions.map((a) => ({ ...a }));
        const first = fitBudget(copy, trip);
        const second = fitBudget(copy, trip);
        expect(second?.total).toBe(first?.total);
        expect(second?.trimmed).toEqual([]);
      }),
    );
  });
  it("without a total budget there is nothing to fit", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 6 }), (actions) => {
        expect(fitBudget(actions, { ...blankTrip(), destination: "Lisbon" })).toBeNull();
        expect(fitBudget(actions, { ...blankTrip(), destination: "Lisbon", budget: { amount: 100, currency: "USD", scope: "per_night" } })).toBeNull();
      }),
    );
  });
});
