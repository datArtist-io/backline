// The trip agent end to end, offline. Every map, taste and model answer here is synthetic.
import { describe, expect, it, vi } from "vitest";
import { arrivalMode, chooseCity, chooseNear, isArrivalStop, tripAgent, neededKinds, niceKinds, type TripAgentOutput } from "../src/skills/trip-agent";
import { keywordPlan, missionSkills } from "../src/missions";
import { normalizeTrip } from "../src/trip-request";
import { runBrief, type BriefEvent } from "../src/orchestrator";
import type { GeoHit, OsmPlace } from "../src/clients/osm";
import type { BriefInput, SkillContext, StepProgress } from "../src/types";
import { ctxWith, entity, stubLlm, stubQloo } from "./helpers";

const TODAY = "2026-10-22";
const SAID =
  "so i'll be going to lagos on the 28th of october and i'm going there for an event so i wanted to plan a trip for me close to the national theater so i'll book an hotel for me close to the national theater and i'm going via the train i'll pay for that myself don't worry about it";

const NG: GeoHit = { name: "Lagos", display: "Lagos, Lagos State, Nigeria", lat: 6.455, lon: 3.394, country: "Nigeria", countryCode: "NG", kind: "city", importance: 0.62, source: "nominatim" };
const PT: GeoHit = { name: "Lagos", display: "Lagos, Faro, Portugal", lat: 37.1, lon: -8.67, country: "Portugal", countryCode: "PT", kind: "town", importance: 0.65, source: "nominatim" };
const THEATRE: GeoHit = { name: "National Arts Theatre", display: "National Arts Theatre, Iganmu, Lagos, Nigeria", lat: 6.4757, lon: 3.368, country: "Nigeria", countryCode: "NG", kind: "theatre", importance: 0.4, source: "nominatim" };
const STATION: GeoHit = { name: "Mobolaji Johnson Station", display: "Mobolaji Johnson Station, Ebute Metta, Lagos, Nigeria", lat: 6.487, lon: 3.382, country: "Nigeria", countryCode: "NG", kind: "station", importance: 0.3, source: "nominatim" };
const AIRPORT: GeoHit = { name: "Murtala Muhammed International Airport", display: "Murtala Muhammed International Airport, Ikeja, Lagos, Nigeria", lat: 6.5774, lon: 3.3212, country: "Nigeria", countryCode: "NG", kind: "aerodrome", importance: 0.5, source: "nominatim" };

const osmPlace = (id: string, name: string, lat: number, lon: number, category: string, extra: Partial<OsmPlace> = {}): OsmPlace => ({
  id,
  url: `https://www.openstreetmap.org/node/${id.slice(5)}`,
  name,
  lat,
  lon,
  category,
  tags: [category === "hotel" ? "Hotel" : "Restaurant"],
  address: null,
  phone: null,
  email: null,
  website: null,
  stars: null,
  hours: null,
  ...extra,
});

function stubOsm() {
  return {
    geocode: vi.fn(async (q: string) => (/theat/i.test(q) ? [THEATRE] : /station/i.test(q) ? [STATION] : /airport/i.test(q) ? [AIRPORT] : /lagos/i.test(q) ? [PT, NG] : [])),
    nearby: vi.fn(async (kind: string) =>
      kind === "stay"
        ? [osmPlace("osm:n1", "Iganmu Suites", 6.4745, 3.3702, "hotel", { stars: 3, phone: "+234 801 111 2222" }), osmPlace("osm:n2", "Surulere Grand Hotel", 6.49, 3.355, "hotel", { stars: 4, email: "stay@surulere.example" })]
        : kind === "dine"
          ? [osmPlace("osm:n3", "Bukka by the Theatre", 6.476, 3.3695, "restaurant", { phone: "+234 803 333 4444" }), osmPlace("osm:n4", "Ofada Corner", 6.48, 3.372, "restaurant")]
          : []
    ),
    route: vi.fn(async (pts: { lat: number; lon: number }[]) => ({ km: 3.2, minutes: 11, legs: pts.slice(1).map(() => ({ km: 1.6, minutes: 6 })), path: pts.map((p) => [p.lat, p.lon] as [number, number]) })),
  };
}

function stubTaste() {
  return stubQloo({
    findTags: vi.fn(async (q: string) => [{ id: `urn:tag:category:place:${q.replace(/\s+/g, "_")}`, name: q, type: "urn:tag:category:place", affinity: null }]),
    insights: vi.fn(async (_t: string, p: { filterTags?: string[] }) =>
      p.filterTags?.[0]?.includes("hotel") ? [entity({ id: "Q-H1", name: "Theatre View Hotel", type: "urn:entity:place", location: { lat: 6.477, lon: 3.3692 }, properties: { business_rating: 4.5, price_level: 2 } })] : []
    ),
  });
}

const tripFor = () => normalizeTrip({ destination: "lagos", startDate: "2026-10-28", near: "national theater", travelMode: "train", selfArranged: ["transport"] }, "lagos", {}, TODAY)!;

function contextWith(llm: SkillContext["llm"] = null): SkillContext & { osm: ReturnType<typeof stubOsm> } {
  return { ...ctxWith({ qloo: stubTaste(), llm }), osm: stubOsm() as never } as SkillContext & { osm: ReturnType<typeof stubOsm> };
}

const input = (): BriefInput => ({ artist: "", trip: tripFor(), request: SAID, today: TODAY, language: "English", profile: {} });

async function runAgentSkill(ctx: SkillContext) {
  const events: StepProgress[] = [];
  const res = await tripAgent.run({ ...ctx, progress: (p) => events.push(p) }, input(), {});
  return { out: res.data as TripAgentOutput, notes: res.notes ?? [], events };
}

describe("choosing the right place", () => {
  it("settles an ambiguous city with country hints, else prominence", () => {
    const c = (h: GeoHit) => ({ ...h, source: "OpenStreetMap" });
    expect(chooseCity([c(PT), c(NG)], "lagos", ["Nigeria"])?.country).toBe("Nigeria");
    expect(chooseCity([c(PT), c(NG)], "Lagos, Portugal", ["Portugal"])?.country).toBe("Portugal");
    expect(chooseCity([c(NG), c(PT)], "lagos", [])?.country).toBe("Portugal");
  });

  it("matches a landmark despite theatre/theater spelling and extra words", () => {
    const c = (h: GeoHit) => ({ ...h, source: "OpenStreetMap" });
    const other = { ...c(THEATRE), name: "Terra Kulture", display: "Terra Kulture, Victoria Island" };
    expect(chooseNear([other, c(THEATRE)], "the national theater", NG)?.name).toBe("National Arts Theatre");
    expect(chooseNear([other], "national theater", NG)).toBeNull();
  });

  it("knows what the user needs found", () => {
    expect(neededKinds(tripFor())).toEqual(["stay", "dine"]);
    expect(neededKinds({ ...tripFor(), event: { type: "launch party", guests: 80, date: null } })).toContain("venue");
  });
});

describe("the agent, driven by a model", () => {
  it("pins Lagos, Nigeria (not Portugal), finds the theatre, and picks a hotel within walking distance", async () => {
    const choose = { thought: "Choosing", finish: { summary: "Theatre View Hotel is a short walk from the theatre.", stays: [{ id: "s1", why: "Closest to the theatre" }], dines: ["d1"] } };
    const decisions = [
      { thought: "Pinning Lagos on the map", actions: [{ tool: "locate", args: { query: "Lagos", role: "city" } }] },
      { thought: "Finding the National Theatre", actions: [{ tool: "locate", args: { query: "national theater", role: "landmark" } }] },
      { thought: "Searching hotels and restaurants around the theatre", actions: [{ tool: "search_places", args: { kind: "stay" } }, { tool: "search_places", args: { kind: "dine" } }] },
      choose,
      // Sent back once: they're coming by train, so the station belongs on the plan.
      { thought: "Finding the station the train arrives at", actions: [{ tool: "locate", args: { query: "Lagos train station", role: "place" } }] },
      choose,
    ];
    const llm = stubLlm(() => decisions.shift());
    const { out, events } = await runAgentSkill(contextWith(llm));
    expect(out.method).toBe("agent");
    expect(out.where.city?.country).toBe("Nigeria");
    expect(out.where.landmark?.name).toBe("National Arts Theatre");
    expect(out.stops[0]).toMatchObject({ id: "p1", name: "National Arts Theatre" });
    expect(out.stays[0].name).toBe("Theatre View Hotel");
    expect(out.stays[0].distanceKm).toBeLessThan(1);
    expect(out.picks.stays).toEqual([out.stays[0].id]);
    expect(out.stays[0].why[0]).toBe("Closest to the theatre");
    expect(out.dines.length).toBeGreaterThan(0);
    expect(out.summary).toContain("short walk");
    expect(out.stops.find((x) => x.kind === "station")?.name).toBe("Mobolaji Johnson Station");
    expect(out.stats.decisions.find((d) => d.note)?.note).toMatch(/arriving by train/);
    expect(events.filter((e) => e.kind === "think").map((e) => e.text)).toContain("Finding the National Theatre");
    expect(events.some((e) => e.kind === "saw" && /hotels within 5 km of National Arts Theatre/.test(e.text))).toBe(true);
  });

  it("finishes on autopilot when the model keeps failing", async () => {
    const llm = stubLlm(() => {
      throw new Error("model down");
    });
    const { out, notes, events } = await runAgentSkill(contextWith(llm));
    expect(out.method).toBe("autopilot");
    expect(out.where.city?.country).toBe("Nigeria");
    expect(out.stays.length).toBeGreaterThan(0);
    expect(out.picks.stays.length).toBe(1);
    expect(notes.join(" ")).toContain("autopilot");
    expect(events.some((e) => e.kind === "note")).toBe(true);
  });

  it("still finds restaurants when the model forgets them", async () => {
    const lazy = { thought: "Done", finish: { stays: ["s1"] } };
    const decisions: unknown[] = [
      { thought: "Pinning", actions: [{ tool: "locate", args: { query: "Lagos, Nigeria", role: "city" } }, { tool: "locate", args: { query: "National Theatre", role: "landmark" } }] },
      { thought: "Hotels", actions: [{ tool: "search_places", args: { kind: "stay" } }] },
    ];
    const llm = stubLlm(() => decisions.shift() ?? lazy);
    const { out } = await runAgentSkill(contextWith(llm));
    expect(out.dines.length).toBeGreaterThan(0);
    expect(out.picks.dines.length).toBeGreaterThan(0);
  });
});

describe("tools", () => {
  it("treats 'Lagos, Nigeria' as a clarification but 'Lagos, Portugal' as a new place", async () => {
    const { createState, tripTools } = await import("../src/skills/trip-agent");
    const ctx = contextWith(null);
    const s = createState(input(), tripFor(), TODAY);
    const tools = new Map(tripTools(ctx, s).map((t) => [t.name, t]));
    await tools.get("locate")!.run({ query: "Lagos", role: "city" }, s, undefined);
    await tools.get("locate")!.run({ query: "national theater", role: "landmark" }, s, undefined);
    await tools.get("update_trip")!.run({ destination: "Lagos, Nigeria", near: "National Theatre" }, s, undefined);
    expect(s.city?.country).toBe("Nigeria");
    expect(s.landmark?.name).toBe("National Arts Theatre");
    await tools.get("update_trip")!.run({ destination: "Lagos, Portugal" }, s, undefined);
    expect(s.city).toBeNull();
    expect(s.landmark).toBeNull();
  });

  it("adds a named restaurant as an option, and a station as a stop on the plan", async () => {
    const { createState, tripTools } = await import("../src/skills/trip-agent");
    const ctx = contextWith(null);
    ctx.osm.geocode.mockImplementation(async (q: string) =>
      /bukka/i.test(q)
        ? [{ ...THEATRE, name: "Bukka Hut Iganmu", display: "Bukka Hut Iganmu, Lagos, Nigeria", kind: "restaurant", lat: 6.476, lon: 3.369 }]
        : /station/i.test(q)
          ? [{ ...THEATRE, name: "Mobolaji Johnson Station", display: "Mobolaji Johnson Station, Ebute Metta, Lagos", kind: "station", lat: 6.49, lon: 3.38 }]
          : [NG]
    );
    const s = createState(input(), tripFor(), TODAY);
    const tools = new Map(tripTools(ctx, s).map((t) => [t.name, t]));
    await tools.get("locate")!.run({ query: "Lagos", role: "city" }, s, undefined);
    const r1 = await tools.get("locate")!.run({ query: "Bukka Hut", role: "place" }, s, undefined);
    expect(r1.observation).toContain("option d1");
    const r2 = await tools.get("locate")!.run({ query: "Lagos train station", role: "place" }, s, undefined);
    expect(r2.observation).toContain("Stop id p1");
    expect(s.stops[0].name).toBe("Mobolaji Johnson Station");
  });
});

describe("the agent without a model", () => {
  it("does the whole job with the same tools", async () => {
    const { out } = await runAgentSkill(contextWith(null));
    expect(out.method).toBe("autopilot");
    expect(out.where.landmark?.name).toBe("National Arts Theatre");
    expect(out.stays.map((p) => p.name)).toContain("Iganmu Suites");
    expect(out.stays.every((p) => (p.distanceKm ?? 0) < 4)).toBe(true);
    expect(out.log.some((l) => l.kind === "act" && l.tool === "search_places")).toBe(true);
  });
});

describe("your Lagos request, start to finish", () => {
  it("plans, maps and prepares bookings from the spoken request, then waits for approval", async () => {
    const plan = keywordPlan(SAID);
    expect(plan.mission).toBe("plan");
    const ctx = contextWith(null);
    const events: BriefEvent[] = [];
    const run = await runBrief(missionSkills("plan"), ctx, { artist: "", trip: plan.trip!, request: SAID, today: TODAY, profile: {} }, (e) => events.push(e), { stopBefore: ["trip.execute"] });
    expect(run.steps["trip.agent"].status).toBe("succeeded");
    expect(run.steps["trip.plan"].status).toBe("succeeded");
    expect(run.steps["trip.routes"].status).toBe("succeeded");
    expect(run.steps["trip.actions"].status).toBe("succeeded");
    expect(run.steps["trip.execute"].status).toBe("waiting");

    const agent = run.results["trip.agent"].data as TripAgentOutput;
    expect(agent.where.city?.display).toContain("Nigeria");
    const routes = run.results["trip.routes"].data as { provider: string; days: { legs: unknown[]; directions: string | null }[] };
    expect(routes.provider).toBe("roads");
    expect(routes.days[0].legs.length).toBeGreaterThan(0);
    expect(routes.days[0].directions).toContain("google.com/maps/dir");
    const actions = (run.results["trip.actions"].data as { actions: { channel: string; url: string | null }[] }).actions;
    expect(actions.find((a) => a.channel === "link")?.url).toContain("Lagos%2C+Nigeria");
    expect(events.filter((e) => e.type === "step.progress" && e.skill === "trip.agent").length).toBeGreaterThan(4);
  });
});

describe("covering what a good assistant would", () => {
  it("knows what's worth finding beyond the request", () => {
    const stayOnly = normalizeTrip({ destination: "lagos", needs: ["stay"], travelMode: "flight" }, "lagos", {}, TODAY)!;
    expect(neededKinds(stayOnly)).toEqual(["stay"]);
    // Somewhere to eat and something to do, so a stay-only trip still has days worth living.
    expect(niceKinds(stayOnly)).toEqual(["dine", "activity"]);
    expect(niceKinds(tripFor())).toEqual(["activity"]);
    expect(arrivalMode({ travelMode: "Train" })).toBe("train");
    expect(arrivalMode({ travelMode: "flight" })).toBe("flight");
    expect(arrivalMode({ travelMode: "car" })).toBeNull();
    expect(arrivalMode({ travelMode: null })).toBeNull();
  });

  it("recognises the station or airport they arrive through, by type or by name", () => {
    expect(isArrivalStop({ name: "Lagos Terminus", kind: "building" })).toBe(true);
    expect(isArrivalStop({ name: "Mobolaji Johnson Station", kind: "train_station" })).toBe(true);
    expect(isArrivalStop({ name: "MMIA", kind: "aerodrome" })).toBe(true);
    expect(isArrivalStop({ name: "National Arts Theatre", kind: "landmark" })).toBe(false);
    expect(isArrivalStop({ name: "Terra Kulture", kind: "arts_centre" })).toBe(false);
  });

  it("finds somewhere to eat near an overnight stay and pins the airport for a flight, without booking either", async () => {
    const trip = normalizeTrip({ destination: "lagos", startDate: "2026-10-28", endDate: "2026-10-30", near: "national theater", travelMode: "flight", needs: ["stay"] }, "lagos", {}, TODAY)!;
    const res = await tripAgent.run(contextWith(null), { ...input(), trip, request: "Book me a hotel near the National Theatre in Lagos, I'm flying in on the 28th" }, {});
    const out = res.data as TripAgentOutput;
    expect(out.dines.map((p) => p.name)).toContain("Bukka by the Theatre");
    expect(out.picks.dines).toEqual([]);
    expect(out.stops.find((x) => x.kind === "aerodrome")?.name).toBe("Murtala Muhammed International Airport");
    expect((res.notes ?? []).join(" ")).not.toMatch(/autopilot/);
  });
});

describe("ids never reach the user", () => {
  it("drops ids next to names and turns bare ids into names", async () => {
    const { nameRefs } = await import("../src/skills/trip-agent");
    const names = new Map([["s1", "NBPLC Lodge"], ["d3", "Lagoon Bar"], ["d4", "The Cabin"], ["p2", "Iddo"]]);
    expect(nameRefs("Stay at NBPLC Lodge (s1, 1 km, 4.3★) and arrive at Iddo (p2).", names)).toBe("Stay at NBPLC Lodge (1 km, 4.3★) and arrive at Iddo.");
    expect(nameRefs("Restaurants d3 and d4 are close; take the A1-2 or A1.", names)).toBe("Restaurants Lagoon Bar and The Cabin are close; take the A1-2 or A1.");
    expect(nameRefs("Check in (S1), then lunch (D3), 1.2 km away.", names)).toBe("Check in, then lunch, 1.2 km away.");
  });
});

describe("text the user reads", () => {
  it("never shows internal ids", async () => {
    const { nameRefs } = await import("../src/skills/trip-agent");
    const names = new Map([["s1", "NBPLC Accommodation Center"], ["p2", "Iddo"], ["d3", "Lagoon Bar"], ["d4", "The Cabin"]]);
    expect(nameRefs("Stay at NBPLC Accommodation Center (S1), 1 km away.", names)).toBe("Stay at NBPLC Accommodation Center, 1 km away.");
    expect(nameRefs("NBPLC Accommodation Center (s1, 1 km, 4.3★) is closest.", names)).toBe("NBPLC Accommodation Center (1 km, 4.3★) is closest.");
    expect(nameRefs("Arrive at Iddo (p2) by train; eat at d3 and d4.", names)).toBe("Arrive at Iddo by train; eat at Lagoon Bar and The Cabin.");
    expect(nameRefs("Take the A1-2 highway", new Map([["a1", "Museum"]]))).toBe("Take the A1-2 highway");
  });
});

describe("hotel lanes from a real run", () => {
  it("puts the hotels found into lanes", async () => {
    const { out } = await runAgentSkill(contextWith(null));
    expect(out.tiers?.length ?? 0).toBeGreaterThan(0);
    expect(out.hotelScores?.length ?? 0).toBeGreaterThan(0);
  });
});
