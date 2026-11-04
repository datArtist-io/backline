// Real fares from Google Flights: the cheapest sensible flight, never a 30-hour detour to save $20.
import { describe, expect, it } from "vitest";
import { GoogleFlightsClient, pickFare } from "../src/clients/google-flights";

const answer = {
  search_metadata: { google_flights_url: "https://www.google.com/travel/flights?q=LOS-FCO" },
  best_flights: [{ price: 712, total_duration: 660, flights: [{ airline: "Ethiopian" }, { airline: "Ethiopian" }], layovers: [{}] }],
  other_flights: [
    { price: 655, total_duration: 1900, flights: [{ airline: "EgyptAir" }, { airline: "ITA" }], layovers: [{}, {}] },
    { price: 690, total_duration: 800, flights: [{ airline: "Turkish Airlines" }, { airline: "Turkish Airlines" }], layovers: [{}] },
    { price: null, total_duration: 500 },
  ],
};

describe("Google Flights fares", () => {
  it("picks the cheapest flight within 40% of the quickest journey", () => {
    expect(pickFare(answer, "USD")).toEqual({ total: 690, currency: "USD", airline: "Turkish Airlines", stops: 1, minutes: 800, url: "https://www.google.com/travel/flights?q=LOS-FCO" });
  });
  it("returns nothing when Google lists no priced flight", () => {
    expect(pickFare({ best_flights: [], other_flights: [{ price: null }] }, "USD")).toBeNull();
    expect(pickFare(null, "USD")).toBeNull();
  });
  it("asks for one way, by airport, for everyone, and fails loudly on an error", async () => {
    let url = "";
    const ok = new GoogleFlightsClient({ apiKey: "k", fetch: (async (u: string) => { url = u; return new Response(JSON.stringify(answer)); }) as never });
    expect((await ok.fare({ from: "LOS", to: "FCO,CIA", date: "2026-11-20", adults: 2, currency: "USD" }))?.total).toBe(690);
    const q = new URL(url).searchParams;
    expect([q.get("engine"), q.get("type"), q.get("departure_id"), q.get("arrival_id"), q.get("adults")]).toEqual(["google_flights", "2", "LOS", "FCO,CIA", "2"]);
    const bad = new GoogleFlightsClient({ apiKey: "k", fetch: (async () => new Response("no", { status: 429 })) as never });
    await expect(bad.fare({ from: "LOS", to: "FCO", date: "2026-11-20", adults: 1, currency: "USD" })).rejects.toThrow(/429/);
  });
});

describe("saving searches", () => {
  it("asks Next.js to keep the answer when a cache time is set", async () => {
    let init: RequestInit & { next?: { revalidate?: number } } = {};
    const c = new GoogleFlightsClient({ apiKey: "k", cacheSeconds: 21600, fetch: (async (_u: string, i: RequestInit) => { init = i; return new Response(JSON.stringify(answer)); }) as never });
    await c.fare({ from: "LOS", to: "FCO", date: "2026-11-20", adults: 2, currency: "USD" });
    expect(init.next?.revalidate).toBe(21600);
  });
});
