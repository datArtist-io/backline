import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runBrief, type BriefEvent } from "../src/orchestrator";
import { guessArtist, keywordPlan, missionSkills, offersSelfArranged, pendingCheckpoints, planGoal, sanitizeSelections, checkpointOptions, tripAck, MISSIONS, MISSION_TYPES } from "../src/missions";
import { normalizeTrip } from "../src/trip-request";
import { validateGraph } from "../src/orchestrator";
import type { BriefInput, Skill } from "../src/types";
import { ctxWith, stubLlm } from "./helpers";

const skill = (id: string, dependsOn: string[], extra: Partial<Skill<BriefInput, unknown>> = {}): Skill<BriefInput, unknown> => ({
  id,
  title: `Step ${id}`,
  dependsOn,
  timeoutMs: 1000,
  output: z.unknown(),
  run: async () => ({ data: id, evidence: [] }),
  ...extra,
});

describe("checkpoints and seeds", () => {
  it("stops before a checkpoint and marks dependents as waiting", async () => {
    const events: BriefEvent[] = [];
    const run = await runBrief([skill("a", []), skill("b", ["a"]), skill("c", ["b"]), skill("d", ["a"])], ctxWith(), { artist: "x" }, (e) => events.push(e), { stopBefore: ["b"] });
    expect(run.status).toBe("waiting");
    expect(run.steps.a.status).toBe("succeeded");
    expect(run.steps.b.status).toBe("waiting");
    expect(run.steps.c.status).toBe("waiting");
    expect(run.steps.d.status).toBe("succeeded");
    expect(events.filter((e) => e.type === "step.waiting").map((e) => e.skill).sort()).toEqual(["b", "c"]);
  });

  it("reuses seeded results instead of re-running them", async () => {
    let calls = 0;
    const a = skill("a", [], { run: async () => ({ data: (calls++, "fresh"), evidence: [] }) });
    const b = skill("b", ["a"], { run: async (_c, _i, deps) => ({ data: `b:${deps.a.data}`, evidence: [] }) });
    const run = await runBrief([a, b], ctxWith(), { artist: "x" }, () => {}, { seed: { a: { data: "seeded", evidence: [] } } });
    expect(calls).toBe(0);
    expect(run.results.b.data).toBe("b:seeded");
  });

  it("runs with optional dependencies that failed", async () => {
    const a = skill("a", [], { run: async () => { throw new Error("boom"); } });
    const b = skill("b", [], { optionalDeps: ["a"], run: async (_c, _i, deps) => ({ data: deps.a ? "with" : "without", evidence: [] }) });
    const run = await runBrief([a, b], ctxWith(), { artist: "x" });
    expect(run.steps.b.status).toBe("succeeded");
    expect(run.results.b.data).toBe("without");
  });

  it("ignores optional dependencies that aren't in the mission", () => {
    expect(() => validateGraph([skill("b", [], { optionalDeps: ["not-here"] })])).not.toThrow();
  });
});

describe("missions", () => {
  it("every mission is a valid graph that includes its checkpoint skills", () => {
    for (const t of MISSION_TYPES) {
      const skills = missionSkills(t);
      expect(() => validateGraph(skills)).not.toThrow();
      const ids = skills.map((s) => s.id);
      for (const cp of MISSIONS[t].checkpoints) {
        expect(ids).toContain(cp.before);
        expect(ids).toContain(cp.optionsFrom);
      }
    }
  });

  it("only pauses in check-with-me mode, and only for unanswered checkpoints", () => {
    expect(pendingCheckpoints("brand_deal", "auto")).toHaveLength(0);
    expect(pendingCheckpoints("brand_deal", "check").map((c) => c.id)).toEqual(["brands"]);
    expect(pendingCheckpoints("brand_deal", "check", { brands: ["b1"] })).toHaveLength(0);
  });

  it("sanitises selections to known checkpoints and limits", () => {
    expect(sanitizeSelections("brand_deal", { brands: ["a", "b", "c", "d", "a"], hack: ["x"] })).toEqual({ brands: ["a", "b", "c"] });
    expect(sanitizeSelections("brand_deal", { brands: ["<script>"] })).toEqual({});
  });

  it("builds brand checkpoint options with new fits recommended", () => {
    const cp = MISSIONS.brand_deal.checkpoints[0];
    const m = (id: string, alreadyPartnered = false) => ({ id, name: id, image: null, affinity: 0.8, fit: 0.7, reasons: ["r1"], alreadyPartnered, positioning: null, markets: [], targetAge: null, partnerships: [] });
    const opts = checkpointOptions(cp, { "brand.matches": { data: { focus: null, focusApplied: false, matches: [m("old", true), m("n1"), m("n2")] }, evidence: [] } });
    expect(opts.find((o) => o.id === "old")?.recommended).toBe(false);
    expect(opts.find((o) => o.id === "n1")?.recommended).toBe(true);
  });
});

describe("planning", () => {
  it("guesses the artist from common phrasings", () => {
    expect(guessArtist("Get a brand deal for Test Artist in London")).toBe("Test Artist");
    expect(guessArtist("Plan Test Artist's Europe tour")).toBe("Test Artist");
    expect(guessArtist("Test Artist")).toBe("Test Artist");
  });

  it("routes by keywords without a model", () => {
    expect(keywordPlan("find sponsors for Test Artist").mission).toBe("brand_deal");
    expect(keywordPlan("plan a tour for Test Artist across Europe")).toMatchObject({ mission: "tour", location: "Europe" });
    expect(keywordPlan("merch ideas for Test Artist").mission).toBe("content");
    expect(keywordPlan("Test Artist").mission).toBe("brief");
  });

  it("uses the model when available and keeps hints authoritative", async () => {
    const llm = stubLlm(() => ({ mission: "tour", artist: "Test Artist", location: "Europe", focus: null, language: "French" }));
    const plan = await planGoal(llm, "Planifie une tournée pour Test Artist en Europe");
    expect(plan).toMatchObject({ mission: "tour", artist: "Test Artist", location: "Europe", language: "French", method: "model" });
    const hinted = await planGoal(llm, "anything", { mission: "brand_deal" });
    expect(hinted.mission).toBe("brand_deal");
  });

  it("falls back to keywords when the model fails, and rejects junk artist names", async () => {
    const llm = stubLlm(() => { throw new Error("down"); });
    const plan = await planGoal(llm, "brand deal for Test Artist");
    expect(plan).toMatchObject({ mission: "brand_deal", artist: "Test Artist", method: "keywords" });
    const junk = await planGoal(null, "!!!");
    expect(junk.artist).toBeNull();
  });
});

describe("agent-like planning", () => {
  it("reads 'my trip' as a trip to plan, with the place as the destination", () => {
    const p = keywordPlan("plan my trip to Lagos today");
    expect(p).toMatchObject({ mission: "plan", artist: null, selfReference: true, location: "Lagos" });
    expect(p.trip?.destination).toBe("Lagos");
  });

  it("routes bookings and events to the planning mission", () => {
    expect(keywordPlan("book a birthday dinner in Accra").mission).toBe("plan");
  });

  it("never mistakes the user or a task for an artist name", () => {
    expect(guessArtist("plan a tour for me")).toBeNull();
    expect(guessArtist("my next tour")).toBeNull();
    expect(guessArtist("brand deal")).toBeNull();
  });

  it("passes through the model's title, acknowledgement and off-topic reply, cleaned", async () => {
    const llm = stubLlm(() => ({ mission: "brief", artist: null, offTopic: true, reply: "I plan artist careers <b>", suggestions: ["Find where your fans are", "", "Plan a tour", "Land a deal", "Extra"], title: "Weather", ack: null, language: "English" }));
    const p = await planGoal(llm, "what's the weather");
    expect(p.offTopic).toBe(true);
    expect(p.reply).toBe("I plan artist careers b");
    expect(p.suggestions).toEqual(["Find where your fans are", "Plan a tour", "Land a deal"]);
  });
});

describe("place parsing", () => {
  it("only treats 'to' as a place when travelling", () => {
    expect(keywordPlan("a brand deal to grow Test Artist").location).toBeNull();
    expect(keywordPlan("plan a trip to Accra, Ghana next week").location).toBe("Accra, Ghana");
  });
});

describe("messy spoken requests", () => {
  const said =
    "so i'll be going to lagos on the 28th of october and i'm going there for an event so i wanted to plan a trip for me close to the national theater so i'll book an hotel for me close to the national theater and i'm going via the train i'll pay for that myself don't worry about it";
  it("finds the real place, date, landmark and what the user handles themselves", async () => {
    const { keywordPlan, guessDate, guessNear, guessLocation } = await import("../src/missions");
    expect(guessLocation(said)).toBe("lagos");
    expect(guessDate("on the 28th of october", "2026-10-22")).toBe("2026-10-28");
    expect(guessDate("on the 2nd of march", "2026-10-22")).toBe("2027-03-02");
    expect(guessNear(said)).toBe("national theater");
    const p = keywordPlan(said);
    expect(p.mission).toBe("plan");
    expect(p.trip).toMatchObject({ destination: "lagos", near: "national theater", travelMode: "train", selfArranged: ["transport"] });
  });
});

describe("what the agent says it will do", () => {
  const trip = normalizeTrip({ destination: "Lagos, Nigeria", near: "National Theatre", travelMode: "train", selfArranged: ["transport"], needs: ["stay"] }, null, {}, "2026-10-22")!;

  it("never offers to book what the user is handling", () => {
    expect(offersSelfArranged("I'll book a hotel near the National Theatre for your stay and arrange train travel for you.", trip)).toBe(true);
    expect(offersSelfArranged("I'll find a hotel near the National Theatre. You're handling the train.", trip)).toBe(false);
    expect(offersSelfArranged("I'll book your hotel.", { ...trip, selfArranged: [] })).toBe(false);
    expect(tripAck(trip)).toBe("I'll find a hotel near National Theatre and plan the trip hour by hour. You're handling the train.");
  });

  it("replaces a title about fans and an ack that offers to book the train", async () => {
    const llm = stubLlm(() => ({
      mission: "plan",
      artist: null,
      selfReference: false,
      location: "Lagos",
      language: "English",
      title: "Plan a Lagos trip around your fans",
      ack: "I'll book a hotel near the National Theatre for your stay and arrange train travel for you.",
      offTopic: false,
      reply: null,
      suggestions: [],
      trip: { destination: "Lagos, Nigeria", startDate: "2026-10-28", near: "National Theatre", travelMode: "train", selfArranged: ["transport"], needs: ["stay"] },
    }));
    const plan = await planGoal(llm, "going to lagos on the 28th for an event, book a hotel close to the national theater, i'm going via the train and i'll pay for that myself", { today: "2026-10-22" });
    expect(plan.title).toBeNull();
    expect(plan.ack).toContain("You're handling the train");
    expect(plan.ack).not.toMatch(/arrange train/);
  });
});

describe("plans that follow a favourite star", () => {
  it("picks up the person from the request, typed or spoken", async () => {
    const { inspiredByIn } = await import("../src/missions");
    expect(inspiredByIn("plan my lagos weekend like burna boy would")).toBe("Burna Boy");
    expect(inspiredByIn("a night out inspired by tems in lagos")).toBe("Tems");
    expect(inspiredByIn("a Wizkid-style night in Lekki")).toBe("Wizkid");
    expect(inspiredByIn("book me a hotel near the theatre")).toBeNull();
    expect(keywordPlan("plan a weekend in lagos like burna boy would").trip?.inspiredBy).toBe("Burna Boy");
  });

  it("keeps the person only if the user named them", async () => {
    const { groundTrip } = await import("../src/trip-request");
    expect(groundTrip({ inspiredBy: "Burna Boy" }, "a weekend like burna boy would")?.inspiredBy).toBe("Burna Boy");
    expect(groundTrip({ inspiredBy: "Davido" }, "a quiet weekend in lagos")?.inspiredBy).toBeNull();
  });
});
