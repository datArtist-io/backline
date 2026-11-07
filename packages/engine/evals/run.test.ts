// Agent evals (the bug-finding book, section 6): the corpus runs through the real trip agent on a
// synthetic world, and the code judges score every run. Two modes:
//   npm run evals            the autopilot baseline (no model, no keys): deterministic, runs in CI
//   EVAL_MODEL=1 npm run evals   the live model chain from the environment (LLM_* keys), nightly
// The gate: every case passes every code judge. The scorecard is written to evals/last-run.json.
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { tripAgent, type TripAgentOutput } from "../src/skills/trip-agent";
import { normalizeTrip, type RawTrip } from "../src/trip-request";
import { createContext } from "../src/context";
import type { BriefInput } from "../src/types";
import { makeWorld } from "./world";
import { judge, type EvalCase, type Verdict } from "./judges";
import corpusJson from "./corpus.json";

const TODAY = "2026-11-07";
const corpus = corpusJson as EvalCase[];
const live = process.env.EVAL_MODEL === "1";
const only = process.env.EVAL_ONLY;
const cases = only ? corpus.filter((c) => c.id.startsWith(only)) : corpus;

type Row = { id: string; group: string; ok: boolean; method: string; stop: string; turns: number; calls: number; ms: number; failed: string[] };
const rows: Row[] = [];

const llm = live ? createContext(process.env).llm : null;

describe(`agent evals (${live ? "live model chain" : "autopilot baseline"})`, () => {
  for (const c of cases) {
    it(`${c.id}: ${c.request.slice(0, 70)}`, async () => {
      const { ctx } = makeWorld({ llm, ...(c.world ?? {}) });
      const trip = normalizeTrip(c.raw as RawTrip, c.raw.destination as string, {}, TODAY);
      expect(trip, "the request normalises").not.toBeNull();
      const input: BriefInput = { artist: "", trip: trip!, request: c.request, today: TODAY, language: "English", profile: {} };
      const t0 = Date.now();
      const res = await tripAgent.run(ctx, input, {});
      const out = res.data as TripAgentOutput;
      const verdicts: Verdict[] = judge(c, out.trip, out);
      const failed = verdicts.filter((v) => !v.pass);
      rows.push({ id: c.id, group: c.group, ok: failed.length === 0, method: out.method, stop: out.stats.stop, turns: out.stats.turns, calls: out.stats.calls, ms: Date.now() - t0, failed: failed.map((f) => `${f.judge}: ${f.detail}`) });
      expect(failed.map((f) => `${f.judge}: ${f.detail}`)).toEqual([]);
    }, 120_000);
  }

  it("writes the scorecard", () => {
    const total = rows.length;
    const pass = rows.filter((r) => r.ok).length;
    const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    const card = {
      at: new Date().toISOString(),
      mode: live ? "live" : "autopilot",
      total,
      pass,
      passRate: total ? Math.round((pass / total) * 1000) / 10 : 0,
      autopilotRuns: rows.filter((r) => r.method === "autopilot").length,
      p95Ms: p95,
      byGroup: Object.fromEntries(["easy", "underspecified", "odd", "hostile"].map((g) => [g, { total: rows.filter((r) => r.group === g).length, pass: rows.filter((r) => r.group === g && r.ok).length }])),
      failures: rows.filter((r) => !r.ok).map((r) => ({ id: r.id, failed: r.failed })),
    };
    mkdirSync("evals/out", { recursive: true });
    writeFileSync("evals/out/last-run.json", JSON.stringify(card, null, 2));
    console.log(`\nEvals: ${pass}/${total} passed (${card.passRate}%), p95 ${p95} ms, autopilot runs ${card.autopilotRuns}`);
  });
});
