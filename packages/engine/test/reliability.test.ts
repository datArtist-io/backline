// Behaviour found in real runs: copied example numbers, "attending" mistaken for "hosting", slow
// map servers, odd model reply shapes, broken model ids, and plans that must still map. Synthetic data.
import { describe, expect, it, vi } from "vitest";
import { groundTrip, mentionsNumber, normalizeTrip } from "../src/trip-request";
import { normalizeDecision } from "../src/agent/runtime";
import { OsmClient, fromNominatimPlaces } from "../src/clients/osm";
import { LlmClient } from "../src/clients/llm";
import { templatePlan, tripDates, toPlace, type Place } from "../src/skills/trip";
import { dayStops, locatedPlaces, outlineDay } from "../src/skills/trip-routes";
import { z } from "zod";
import { entity } from "./helpers";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const SAID =
  "so i'll be going to lagos on the 28th of october and i'm going there for an event so i wanted to plan a trip for me close to the national theater and i'm going via the train i'll pay for that myself";

describe("keeping to what the user said", () => {
  it("recognises numbers however they're written", () => {
    expect(mentionsNumber("budget is 2,000,000 naira", 2000000)).toBe(true);
    expect(mentionsNumber("about 2m for everything", 2000000)).toBe(true);
    expect(mentionsNumber("150k a night", 150000)).toBe(true);
    expect(mentionsNumber("dinner for four", 4)).toBe(true);
    expect(mentionsNumber("me and my wife", 2)).toBe(true);
    expect(mentionsNumber(SAID, 2000000)).toBe(false);
    expect(mentionsNumber("on the 28th", 8)).toBe(false);
  });

  it("drops invented budgets and guests, and reads 'going for an event' as attending", () => {
    const g = groundTrip({ destination: "Lagos, Nigeria", budgetAmount: 2000000, currency: "NGN", eventType: "event", eventGuests: 1, near: "National Theatre", needs: ["stay", "venue"] }, SAID)!;
    expect(g).toMatchObject({ budgetAmount: null, eventType: null, eventGuests: null, purpose: "Attending an event", needs: ["stay"] });
    const t = normalizeTrip(g, null, {}, "2026-10-22")!;
    expect(t.event).toBeNull();
    expect(t.needs).not.toContain("venue");
    expect(t.assumptions.join(" ")).toContain("mid-range");
  });

  it("keeps a real hosted event and a stated budget", () => {
    const text = "Plan my 30th birthday dinner in Accra for 12 people, budget 15,000 cedis";
    const g = groundTrip({ destination: "Accra", eventType: "birthday dinner", eventGuests: 12, budgetAmount: 15000 }, text)!;
    expect(g).toMatchObject({ eventType: "birthday dinner", eventGuests: 12, budgetAmount: 15000 });
    expect(groundTrip({ destination: "Accra", eventType: "birthday dinner" }, "plan a birthday dinner in Accra")!.eventType).toBe("birthday dinner");
  });
});

describe("reading more model reply shapes", () => {
  it("accepts an action named as a string, a single action object and tool_name", () => {
    expect(normalizeDecision({ thought: "Searching", action: "search_places", args: { kind: "stay" } }).actions).toEqual([{ tool: "search_places", args: { kind: "stay" } }]);
    expect(normalizeDecision({ thought: "x", actions: { tool: "locate", args: { query: "Lagos", role: "city" } } }).actions[0].tool).toBe("locate");
    expect(normalizeDecision({ tool_name: "research", question: "When does it start?" }).actions).toEqual([{ tool: "research", args: { question: "When does it start?" } }]);
  });
});

describe("maps when Overpass is down", () => {
  it("falls back to Nominatim's category search within the same area", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("interpreter")) return new Response("busy", { status: 504 });
      if (url.includes("%5Bhotel%5D"))
        return json([
          { osm_type: "node", osm_id: 9, lat: "6.478", lon: "3.369", name: "Close Inn", type: "hotel", extratags: { phone: "+234 1 000", website: "https://closeinn.example", stars: "3" }, address: { road: "Iganmu Road", city: "Lagos" } },
          { osm_type: "node", osm_id: 10, lat: "6.60", lon: "3.50", name: "Far Hotel", type: "hotel", extratags: {} },
        ]);
      return json([]);
    });
    const osm = new OsmClient({ fetch: fetch as unknown as typeof globalThis.fetch, minIntervalMs: 0 });
    const found = await osm.nearby("stay", { lat: 6.4757, lon: 3.368 }, 3000, { budgetMs: 8000 });
    expect(found.map((p) => p.name)).toEqual(["Close Inn"]);
    expect(found[0]).toMatchObject({ id: "osm:n9", phone: "+234 1 000", stars: 3, address: "Iganmu Road, Lagos" });
    // One quick refusal earns one retry elsewhere, never a long wait.
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes("interpreter")).length).toBeLessThanOrEqual(2);
  });

  it("reads Nominatim place answers safely", () => {
    expect(fromNominatimPlaces([{ osm_type: "way", osm_id: 3, lat: "1", lon: "2", name: "", type: "hotel" }, { lat: "x" }])).toEqual([]);
  });
});

describe("models that don't exist or think too long", () => {
  it("uses the main model when the fast model isn't served, and remembers", async () => {
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      calls.push(model);
      if (model === "nope-fast") return new Response('{"error":{"message":"The model `nope-fast` does not exist"}}', { status: 404 });
      return json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] });
    }) as typeof fetch;
    try {
      const llm = new LlmClient({ apiKey: "k", baseUrl: "https://llm.example/v1", models: { default: "main", fast: "nope-fast" } });
      expect(await llm.json({ tier: "fast", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) })).toEqual({ ok: true });
      expect(llm.modelFor("fast")).toBe("main");
      await llm.json({ tier: "fast", system: "s", user: "u", schema: z.object({ ok: z.boolean() }) });
      expect(calls).toEqual(["nope-fast", "main", "main"]);
      expect(llm.recentCalls().map((r) => r.ok)).toEqual([false, true, true]);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("gives a model that ran out of tokens more room instead of failing", async () => {
    const budgets: number[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      budgets.push(body.max_tokens);
      return budgets.length === 1 ? json({ choices: [{ message: { content: "" }, finish_reason: "length" }] }) : json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] });
    }) as typeof fetch;
    try {
      const llm = new LlmClient({ apiKey: "k", baseUrl: "https://llm.example/v1", models: { default: "main" } });
      expect(await llm.json({ system: "s", user: "u", schema: z.object({ ok: z.boolean() }), maxTokens: 500 })).toEqual({ ok: true });
      expect(budgets).toEqual([500, 1000]);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("plans that always map", () => {
  const hotel: Place = { ...toPlace(entity({ id: "H", name: "Theatre View Hotel", type: "urn:entity:place", location: { lat: 6.478, lon: 3.369 } }), "stay"), distanceKm: 0.3 };
  const food: Place = { ...toPlace(entity({ id: "R", name: "Bukka", type: "urn:entity:place", location: { lat: 6.474, lon: 3.367 } }), "dine"), distanceKm: 0.2 };
  const stops = [
    { id: "p1", name: "National Theatre", lat: 6.4757, lon: 3.368, label: "Attending an event", kind: "landmark" },
    { id: "p2", name: "Mobolaji Johnson Station", lat: 6.488, lon: 3.381, label: "Ebute Metta", kind: "station" },
  ];
  const trip = normalizeTrip({ destination: "Lagos, Nigeria", startDate: "2026-10-28", near: "National Theatre", purpose: "Attending an event", travelMode: "train", selfArranged: ["transport"] }, null, {}, "2026-10-22")!;

  it("builds the template around the station, the landmark and meals", () => {
    const plan = templatePlan(trip, [hotel], [food], [], tripDates(trip.startDate, trip.endDate), { stops, picks: { stays: ["H"], dines: ["R"], venues: [], activities: [] }, city: "Lagos, Nigeria" });
    const day1 = plan.days[0].items.map((i) => i.placeId);
    expect(day1).toEqual(["p2", "H", "p1", "R"]);
    expect(plan.days[0].items[2].title).toBe("Attending an event at National Theatre");
    expect(plan.days[2].items.map((i) => i.placeId)).toEqual(["H", "p2"]);
    expect(plan.summary).toContain("Theatre View Hotel");
  });

  it("routes day one from the agent's picks when there's no written plan", () => {
    const a = { trip, picks: { stays: ["H"], dines: ["R"], venues: [], activities: [] }, stops, stays: [hotel], dines: [food], venues: [], activities: [] };
    const day = outlineDay(a);
    const route = dayStops(day, 0, 1, locatedPlaces(a), "H");
    expect(route.map((s) => s.id)).toEqual(["p2", "H", "p1", "R"]);
  });
});
