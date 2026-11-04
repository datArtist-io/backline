// The agent decides when to look up fares and events; the fixed steps after it reuse its answers.
// Synthetic data only.
import { describe, expect, it, vi } from "vitest";
import { createState, tripAgent, tripTools, type TripAgentOutput } from "../src/skills/trip-agent";
import { tripTravel } from "../src/skills/trip-travel";
import { shared, tripKey } from "../src/skills/shared";
import { normalizeTrip } from "../src/trip-request";
import type { BriefInput, SkillContext, StepProgress } from "../src/types";
import { ctxWith, stubLlm } from "./helpers";

const TODAY = "2026-11-04";
const trip = (extra: Record<string, unknown> = {}) =>
  normalizeTrip({ destination: "Rome, Italy", origin: "Lagos, Nigeria", startDate: "2026-11-20", endDate: "2026-11-27", adults: 2, budgetAmount: 3000, currency: "USD", ...extra }, "rome", {}, TODAY)!;

function context(llm: SkillContext["llm"] = null) {
  const fare = vi.fn(async (q: { from: string }) => ({ total: q.from === "LOS" ? 1280 : 1180, currency: "USD", airline: "Ethiopian", stops: 1, minutes: 680, url: "https://www.google.com/travel/flights?x" }));
  const ctx = {
    ...ctxWith({ llm }),
    googleFlights: { name: "Google Flights", fare } as never,
    flights: { sandbox: true, airportCodes: vi.fn(async (q: string) => (/lagos/i.test(q) ? ["LOS"] : /rome/i.test(q) ? ["FCO", "CIA"] : [])) } as never,
    osm: {
      geocode: vi.fn(async () => [{ name: "Rome", display: "Rome, Lazio, Italy", lat: 41.89, lon: 12.49, country: "Italy", countryCode: "IT", kind: "city", importance: 0.8, source: "nominatim" }]),
      nearby: vi.fn(async () => []),
      route: vi.fn(async () => null),
    } as never,
  } as SkillContext;
  return { ctx, fare };
}
const input = (t = trip()): BriefInput => ({ artist: "", trip: t, request: "A week in Rome from Lagos for two, $3,000", today: TODAY, language: "English", profile: {} });

describe("the agent looks up getting there itself", () => {
  it("reads the live fare and weighs it against the budget", async () => {
    const { ctx, fare } = context();
    const inp = input();
    const s = createState(inp, inp.trip!, TODAY);
    const tool = tripTools(ctx, s).find((t) => t.name === "find_travel")!;
    const out = await tool.run({}, s, undefined);
    expect(fare).toHaveBeenCalledTimes(2);
    expect(out.observation).toMatch(/LIVE for these dates; back 590 USD/);
    expect(out.observation).toMatch(/Flights for 2, return: 2460 USD\. That leaves about 540 USD of the 3000 USD budget.*tight, so lean to cheaper stays/);
    expect(out.summary).toMatch(/Live fare: 2,460 USD return for 2/);
    expect(s.travel?.options[0].live).toBe(true);
  });

  it("the fixed step after it reuses that answer instead of asking Google again", async () => {
    const { ctx, fare } = context();
    const inp = input();
    const s = createState(inp, inp.trip!, TODAY);
    await tripTools(ctx, s).find((t) => t.name === "find_travel")!.run({}, s, undefined);
    const after = await tripTravel.run(ctx, inp, { "trip.agent": { data: { trip: s.trip } as never, evidence: [], notes: [] } });
    expect(fare).toHaveBeenCalledTimes(2);
    expect(after.data.options[0]).toMatchObject({ live: true, priceMin: 640, returnPrice: 590 });
  });

  it("isn't offered when they arrange their own transport", () => {
    const { ctx } = context();
    const inp = input(trip({ selfArranged: ["transport"] }));
    const s = createState(inp, inp.trip!, TODAY);
    const tool = tripTools(ctx, s).find((t) => t.name === "find_travel")!;
    expect(tool.available?.(s) ?? true).toBe(false);
  });

  it("is a step the model chooses, shown to the user as it reasons", async () => {
    const decisions = [
      { thought: "Pinning Rome and checking real fares from Lagos", actions: [{ tool: "locate", args: { query: "Rome, Italy", role: "city" } }, { tool: "find_travel", args: {} }] },
      { thought: "Flights leave only about $540, so I will look at cheaper stays", finish: { summary: "A week in Rome." } },
    ];
    const { ctx, fare } = context(stubLlm(() => decisions.shift()));
    const events: StepProgress[] = [];
    const res = await tripAgent.run({ ...ctx, progress: (p) => events.push(p) }, input(), {});
    const out = res.data as TripAgentOutput;
    expect(out.method).not.toBe("autopilot");
    expect(fare).toHaveBeenCalledTimes(2);
    expect(out.stats.trace![0].calls.map((c) => c.tool)).toEqual(["locate", "find_travel"]);
    expect(events.some((e) => e.kind === "think" && /cheaper stays/.test(e.text))).toBe(true);
    expect(events.some((e) => e.kind === "act" && e.tool === "find_travel" && /Checking live fares from Lagos to Rome/.test(e.text))).toBe(true);
  });

  it("the autopilot uses the same tool when there's no model", async () => {
    const { ctx, fare } = context(null);
    const events: StepProgress[] = [];
    await tripAgent.run({ ...ctx, progress: (p) => events.push(p) }, input(), {});
    expect(events.some((e) => e.kind === "act" && e.tool === "find_travel")).toBe(true);
    expect(fare).toHaveBeenCalledTimes(2);
  });
});

describe("one lookup per run", () => {
  it("shares a lookup within a run and keeps runs apart", async () => {
    const make = vi.fn(async () => 1);
    const a = {}, b = {};
    await Promise.all([shared(a, "k", make), shared(a, "k", make)]);
    await shared(b, "k", make);
    expect(make).toHaveBeenCalledTimes(2);
  });
  it("asks again after a failure, and when the trip changes", async () => {
    const scope = {};
    await expect(shared(scope, "k", async () => { throw new Error("x"); })).rejects.toThrow();
    expect(await shared(scope, "k", async () => 2)).toBe(2);
    expect(tripKey("travel", trip())).not.toBe(tripKey("travel", trip({ endDate: "2026-11-28" })));
  });
});

describe("its self-check", () => {
  it("sends a finish back once when it hasn't looked at getting there", async () => {
    const { checkFinish } = await import("../src/skills/trip-agent");
    const inp = input();
    const s = createState(inp, inp.trip!, TODAY);
    s.searched = new Set(["stay", "dine", "venue", "activity"]);
    expect(checkFinish({}, s)).toMatch(/coming from Lagos, Nigeria: call find_travel/);
    expect(checkFinish({}, s) ?? "").not.toMatch(/find_travel/);
  });
});
