// "Know before you go": weather, money, holidays, taste tips and cited research. Synthetic data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countryCurrency,
  daysFromForecast,
  daysFromHistory,
  holidaysIn,
  packingFrom,
  shapeResearch,
  shiftYears,
  tasteTips,
  tripIntel,
  weatherLabel,
  weatherSummary,
  type DayWeather,
} from "../src/skills/trip-intel";
import type { TasteOutput } from "../src/skills/taste";
import type { TripAgentOutput } from "../src/skills/trip-agent";
import type { WebResult } from "../src/clients/web";
import { ctxWith, stubLlm } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const day = (o: Partial<DayWeather>): DayWeather => ({ date: "2026-11-14", tmax: 30, tmin: 24, rainChance: 10, rainMm: 0, code: 1, label: "Mostly sunny", sunrise: "06:30", sunset: "18:20", ...o });

describe("weather", () => {
  it("turns a forecast response into trip days", () => {
    const days = daysFromForecast({
      time: ["2026-11-14", "2026-11-15"],
      weather_code: [1, 61],
      temperature_2m_max: [31.4, 28.6],
      temperature_2m_min: [24.2, 23.9],
      precipitation_probability_max: [10, 80],
      precipitation_sum: [0, 6.25],
      sunrise: ["2026-11-14T06:31", "2026-11-15T06:32"],
      sunset: ["2026-11-14T18:21", "2026-11-15T18:21"],
    });
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ date: "2026-11-14", tmax: 31, tmin: 24, rainChance: 10, label: "Mostly sunny", sunrise: "06:31", sunset: "18:21" });
    expect(days[1]).toMatchObject({ tmax: 29, rainChance: 80, rainMm: 6.3, label: "Rain" });
    expect(daysFromForecast(undefined)).toEqual([]);
  });

  it("averages past years into what to expect, with the share of years it rained", () => {
    const yr = (rain: number, tmax: number) => ({ weather_code: [rain >= 1 ? 61 : 1], temperature_2m_max: [tmax], temperature_2m_min: [tmax - 6], precipitation_sum: [rain], sunrise: ["2025-11-14T06:30"], sunset: ["2025-11-14T18:20"] });
    const [d] = daysFromHistory(["2026-11-14"], [yr(0, 30), yr(4, 28), yr(2, 29)]);
    expect(d).toMatchObject({ tmax: 29, tmin: 23, rainChance: 67, sunrise: "06:30" });
  });

  it("shifts dates back by whole years, handling Feb 29", () => {
    expect(shiftYears("2026-11-14", -1)).toBe("2025-11-14");
    expect(shiftYears("2028-02-29", -1)).toBe("2027-02-28");
  });

  it("describes weather in words and suggests what to pack", () => {
    expect(weatherLabel(0)).toBe("Clear");
    expect(weatherLabel(63)).toBe("Rain");
    expect(weatherLabel(96)).toBe("Thunderstorms");
    expect(weatherLabel(null)).toBe("Unknown");
    const hotWet = [day({ rainChance: 70, rainMm: 5 }), day({ date: "2026-11-15", tmax: 33 })];
    const pack = packingFrom(hotWet);
    expect(pack).toContain("A light rain jacket or a compact umbrella");
    expect(pack).toContain("Light, breathable clothes, sunscreen and a hat");
    expect(packingFrom([day({ tmax: 8, tmin: 1, rainChance: 0 })])).toEqual(["Warm layers and a coat", "Gloves and a warm hat for mornings and evenings", "Comfortable walking shoes"]);
    expect(packingFrom([])).toEqual([]);
    expect(weatherSummary(hotWet, "forecast")).toBe("Expect highs of 30–33°C and lows of 24–24°C; rain likely on 1 of 2 days.");
    expect(weatherSummary([day({ rainChance: 5 })], "history")).toBe("Usually highs of 30–30°C and lows of 24–24°C; rain unlikely.");
    expect(weatherSummary([], "forecast")).toBeNull();
  });
});

describe("money and holidays", () => {
  it("knows the local currency for common destinations", () => {
    expect(countryCurrency("NG")).toBe("NGN");
    expect(countryCurrency("fr")).toBe("EUR");
    expect(countryCurrency("JP")).toBe("JPY");
    expect(countryCurrency("ZZ")).toBeNull();
    expect(countryCurrency(null)).toBeNull();
  });

  it("keeps only the holidays inside the trip, sorted", () => {
    const all = [
      { date: "2026-12-25", name: "Christmas Day", localName: "Christmas Day" },
      { date: "2026-12-26", name: "Boxing Day", localName: "Boxing Day" },
      { date: "2026-10-01", name: "Independence Day", localName: "Ọjọ́ Ìdáǹdè" },
    ];
    expect(holidaysIn(all, "2026-12-24", "2026-12-27")).toEqual([
      { date: "2026-12-25", name: "Christmas Day", local: null },
      { date: "2026-12-26", name: "Boxing Day", local: null },
    ]);
    expect(holidaysIn(all, "2026-10-01", null)).toEqual([{ date: "2026-10-01", name: "Independence Day", local: "Ọjọ́ Ìdáǹdè" }]);
    expect(holidaysIn(all, null, null)).toEqual([]);
  });
});

describe("taste tips (Qloo)", () => {
  const taste: TasteOutput = {
    signals: [{ id: "e1", name: "Burna Boy", type: "artist" }],
    tags: [],
    vibes: ["energetic"],
    scenes: ["live music venue", "rooftop bar"],
    dishes: ["suya", "jollof rice"],
    priceLean: 3,
    audience: "25–34",
    alsoLoved: [{ id: "e2", name: "Wizkid", type: "artist", image: null }],
    zone: { name: "Victoria Island", lat: 6.43, lon: 3.42, radiusKm: 2, points: 9 },
    heat: [],
  };

  it("builds tips from the taste profile, led by where it lives in the city", () => {
    const tips = tasteTips(taste);
    expect(tips.length).toBeLessThanOrEqual(6);
    expect(tips[0].tip).toContain("Victoria Island");
    expect(tips[0].because).toContain("Burna Boy");
    expect(tips.some((t) => t.tip.startsWith("Order suya"))).toBe(true);
    expect(tips.some((t) => t.tip.includes("Wizkid"))).toBe(true);
  });

  it("gives nothing when there is no taste", () => {
    expect(tasteTips(null)).toEqual([]);
    expect(tasteTips({ ...taste, signals: [], tags: [], scenes: [], dishes: [], alsoLoved: [], zone: null, audience: null })).toEqual([]);
  });
});

describe("cited research", () => {
  const sources: WebResult[] = [
    { title: "Travel advice", url: "https://www.gov.example/travel/ng", content: "…", publishedDate: null },
    { title: "Lagos walking tours", url: "https://tours.example/lagos", content: "…", publishedDate: null },
  ];

  it("keeps cited items with their source and marks the rest unverified", () => {
    const out = shapeResearch(
      {
        sections: [
          { id: "entry", items: [{ text: "Most visitors need a visa before arrival.", source: "w1" }] },
          { id: "safety", items: [{ text: "Use ride apps after dark.", source: null }, { text: "   ", source: "w1" }] },
          { id: "nonsense", items: [{ text: "Ignored section", source: "w1" }] },
        ],
        emergency: { police: "112", ambulance: "112", fire: null, general: "112", source: "w1" },
        phrases: [{ say: "E kaabo", means: "Welcome" }, { say: "", means: "empty" }],
        guides: [
          { name: "Lagos Walking Co.", kind: "walking tour", why: "Fits your taste for live music", source: "w2" },
          { name: "Invented Tours", kind: "tour", why: "No source", source: "w99" },
        ],
      },
      sources
    );
    expect(out.sections.map((s) => s.id)).toEqual(["entry", "safety"]);
    expect(out.sections[0].items[0]).toMatchObject({ verified: true, url: "https://www.gov.example/travel/ng", site: "gov.example" });
    expect(out.sections[1].items).toEqual([{ text: "Use ride apps after dark.", url: null, site: null, verified: false }]);
    expect(out.emergency).toMatchObject({ police: "112", verified: true });
    expect(out.phrases).toEqual([{ say: "E kaabo", means: "Welcome" }]);
    expect(out.guides).toHaveLength(1);
    expect(out.guides[0]).toMatchObject({ name: "Lagos Walking Co.", url: "https://tours.example/lagos", site: "tours.example" });
    expect(out.evidence.map((e) => (e.source === "web" ? e.url : ""))).toEqual(["https://www.gov.example/travel/ng", "https://tours.example/lagos"]);
  });
});

describe("the skill", () => {
  const agent = {
    trip: { destination: "Lagos, Nigeria", startDate: "2026-11-14", endDate: "2026-11-16", adults: 2, rooms: 1, budget: { amount: null, currency: "NGN", scope: null }, priceTier: null, purpose: null, event: null, needs: [], near: null, travelMode: null, selfArranged: [], assumptions: [] },
    where: { city: { name: "Lagos", display: "Lagos, Nigeria", lat: 6.45, lon: 3.4, country: "Nigeria", countryCode: "NG", source: "osm" }, landmark: null },
  } as unknown as TripAgentOutput;

  it("still returns taste tips and says what's missing when the outside services are down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const r = await tripIntel.run(ctxWith(), { artist: "x", today: "2026-10-26", profile: { currency: "USD" } }, { "trip.agent": { data: agent, evidence: [] } });
    expect(tripIntel.output.safeParse(r.data).success).toBe(true);
    expect(r.data.weather.basis).toBe("none");
    expect(r.data.money.rate).toBeNull();
    expect(r.data.sections).toEqual([]);
    expect(r.data.gaps).toEqual(expect.arrayContaining(["Weather for your dates", "Entry, safety and culture notes"]));
  });

  it("assembles weather, rate, holidays and cited research", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        urls.push(String(u));
        if (String(u).includes("archive-api")) return Response.json({ timezone: "Africa/Lagos", utc_offset_seconds: 3600, daily: { time: ["x", "y", "z"], weather_code: [1, 1, 61], temperature_2m_max: [31, 30, 29], temperature_2m_min: [25, 24, 24], precipitation_sum: [0, 0, 5], sunrise: ["a T06:30", "a T06:30", "a T06:31"], sunset: ["a T18:20", "a T18:20", "a T18:19"] } });
        if (String(u).includes("open.er-api")) return Response.json({ result: "success", time_last_update_utc: "Mon, 26 Oct 2026 00:02:31 +0000", rates: { NGN: 1500.4 } });
        if (String(u).includes("nager")) return Response.json([{ date: "2026-11-15", name: "Test Day", localName: "Test Day" }]);
        return new Response("no", { status: 404 });
      })
    );
    const web = { provider: "stub", search: vi.fn(async () => [{ title: "Gov advice", url: "https://gov.example/ng", content: "Visa needed", publishedDate: null }]) };
    const llm = stubLlm(() => ({ sections: [{ id: "entry", items: [{ text: "A visa is needed for most visitors.", source: "w1" }] }], emergency: { police: "112", ambulance: "112", source: null }, phrases: [{ say: "Bawo ni", means: "How are you?" }], guides: [{ name: "Gov Guide", kind: "tour", why: "x", source: "w1" }] }));
    const ctx = { ...ctxWith({ llm }), web } as ReturnType<typeof ctxWith>;
    const r = await tripIntel.run(ctx, { artist: "x", today: "2026-10-26", profile: { currency: "USD" } }, { "trip.agent": { data: agent, evidence: [] } });
    expect(tripIntel.output.safeParse(r.data).success).toBe(true);
    expect(r.data.weather.basis).toBe("history");
    expect(r.data.weather.days).toHaveLength(3);
    expect(r.data.time).toEqual({ zone: "Africa/Lagos", utcOffsetHours: 1 });
    expect(r.data.money).toMatchObject({ home: "USD", local: "NGN", rate: 1500, asOf: "2026-10-26" });
    expect(r.data.money.examples[0]).toEqual({ home: 10, local: 15004 });
    expect(r.data.holidays).toEqual([{ date: "2026-11-15", name: "Test Day", local: null }]);
    expect(r.data.sections[0]).toMatchObject({ id: "entry", items: [{ verified: true, url: "https://gov.example/ng" }] });
    expect(r.data.emergency?.verified).toBe(false);
    expect(r.data.guides[0].url).toBe("https://gov.example/ng");
    expect(urls.some((u) => u.includes("api.open-meteo.com/v1/forecast"))).toBe(false); // Nov 14 is past the 16-day forecast window
    expect(r.evidence.some((e) => e.source === "web")).toBe(true);
  });
});
