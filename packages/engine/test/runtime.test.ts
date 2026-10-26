import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, normalizeDecision, runAgent, type Decision, type Policy } from "../src/agent/runtime";
import type { StepProgress } from "../src/types";

type S = { log: string[] };

const echo = (name: string, extra: Partial<Parameters<typeof defineTool<S, { q: string }>>[0]> = {}) =>
  defineTool<S, { q: string }>({
    name,
    description: `${name} things`,
    args: '{"q": string}',
    schema: z.object({ q: z.string().min(1) }),
    label: (a) => `${name} ${a.q}`,
    run: async (a, s) => {
      s.log.push(`${name}:${a.q}`);
      return { observation: `${name} saw ${a.q}`, summary: `${name} done` };
    },
    ...extra,
  });

const scripted = (decisions: (Decision | Error)[], name: Policy<S>["name"] = "model"): Policy<S> & { decide: ReturnType<typeof vi.fn> } => {
  const queue = [...decisions];
  return {
    name,
    decide: vi.fn(async () => {
      const d = queue.shift() ?? { thought: "done", actions: [], finish: { ok: true } };
      if (d instanceof Error) throw d;
      return d;
    }),
  };
};

const finish = { schema: z.object({ ok: z.boolean() }) };
const limits = { maxTurns: 6, maxCalls: 10, deadlineMs: 10_000 };

describe("reading model replies", () => {
  it("accepts the usual shapes", () => {
    expect(normalizeDecision({ thought: "go", actions: [{ tool: "a", args: { q: "x" } }] })).toEqual({ thought: "go", actions: [{ tool: "a", args: { q: "x" } }], finish: undefined });
    expect(normalizeDecision({ thought: "flat", tool: "a", q: "x" }).actions).toEqual([{ tool: "a", args: { q: "x" } }]);
    expect(normalizeDecision({ tool_calls: [{ type: "function", function: { name: "a", arguments: '{"q":"y"}' } }] }).actions).toEqual([{ tool: "a", args: { q: "y" } }]);
    expect(normalizeDecision({ action: { name: "a", parameters: { q: "z" } } }).actions).toEqual([{ tool: "a", args: { q: "z" } }]);
    expect(normalizeDecision({ thought: "end", actions: [{ tool: "finish", args: { ok: true } }] })).toEqual({ thought: "end", actions: [], finish: { ok: true } });
    expect(normalizeDecision("nonsense")).toEqual({ thought: "", actions: [], finish: undefined });
  });
});

describe("the agent loop", () => {
  it("runs tools in parallel, streams every step, and finishes", async () => {
    const events: StepProgress[] = [];
    const state: S = { log: [] };
    const policy = scripted([
      { thought: "Looking in two places", actions: [{ tool: "a", args: { q: "1" } }, { tool: "b", args: { q: "2" } }] },
      { thought: "All set", actions: [], finish: { ok: true } },
    ]);
    const run = await runAgent({ tools: [echo("a"), echo("b")], state, policy, finish, limits, emit: (e) => events.push(e) });
    expect(run).toMatchObject({ stop: "finished", finish: { ok: true }, calls: 2, usedFallback: false });
    expect(state.log.sort()).toEqual(["a:1", "b:2"]);
    expect(events.map((e) => e.kind)).toEqual(["think", "act", "act", "saw", "saw", "think"]);
    expect(events[1]).toMatchObject({ kind: "act", text: "a 1", tool: "a", by: "model" });
    // The second decision saw the first turn's results.
    const view = policy.decide.mock.calls[1][0] as { turns: { calls: { observation: string }[] }[] };
    expect(view.turns[0].calls.map((c) => c.observation)).toEqual(["a saw 1", "b saw 2"]);
  });

  it("explains bad arguments and unknown tools instead of crashing", async () => {
    const policy = scripted([{ thought: "oops", actions: [{ tool: "a", args: { q: "" } }, { tool: "nope", args: {} }] }]);
    const run = await runAgent({ tools: [echo("a")], state: { log: [] }, policy, finish, limits });
    const [bad, unknown] = run.turns[0].calls;
    expect(bad.ok).toBe(false);
    expect(bad.observation).toContain("didn't fit");
    expect(unknown.observation).toContain('There\'s no tool called "nope". Use one of: a.');
    expect(run.calls).toBe(0);
  });

  it("answers a repeated call from memory and enforces per-tool limits", async () => {
    const state: S = { log: [] };
    const policy = scripted([
      { thought: "", actions: [{ tool: "a", args: { q: "same" } }] },
      { thought: "", actions: [{ tool: "a", args: { q: "same" } }] },
      { thought: "", actions: [{ tool: "a", args: { q: "other" } }] },
    ]);
    const run = await runAgent({ tools: [echo("a", { limit: 1 })], state, policy, finish, limits });
    expect(state.log).toEqual(["a:same"]);
    expect(run.turns[1].calls[0].cached).toBe(true);
    expect(run.turns[2].calls[0].observation).toContain("used as much as allowed");
  });

  it("sends a weak finish back, then accepts the fixed one", async () => {
    const check = vi.fn((f: { ok: boolean }) => (f.ok ? null : "Not done yet: try again."));
    const policy = scripted([
      { thought: "", actions: [], finish: { ok: false } },
      { thought: "", actions: [], finish: { ok: true } },
    ]);
    const run = await runAgent({ tools: [echo("a")], state: { log: [] }, policy, finish: { ...finish, check }, limits });
    expect(run.turns[0].note).toBe("Not done yet: try again.");
    expect(run.finish).toEqual({ ok: true });
  });

  it("hands over to the fallback when the model fails twice", async () => {
    const events: StepProgress[] = [];
    const model = scripted([new Error("timeout"), new Error("timeout")]);
    const auto = scripted([{ thought: "Autopilot here", actions: [{ tool: "a", args: { q: "x" } }] }, { thought: "Done", actions: [], finish: { ok: true } }], "autopilot");
    const run = await runAgent({ tools: [echo("a")], state: { log: [] }, policy: model, fallback: auto, finish, limits, emit: (e) => events.push(e) });
    expect(run).toMatchObject({ stop: "finished", usedFallback: true, fallbackReason: "failures" });
    expect(events.find((e) => e.kind === "note")?.text).toContain("autopilot");
    expect(events.filter((e) => e.kind === "act")[0].by).toBe("autopilot");
  });

  it("lets the fallback finish when the model runs out of turns", async () => {
    const model = scripted(Array.from({ length: 10 }, (_, i) => ({ thought: "more", actions: [{ tool: "a", args: { q: String(i) } }] })));
    const auto = scripted([{ thought: "Wrapping up", actions: [], finish: { ok: true } }], "autopilot");
    const run = await runAgent({ tools: [echo("a")], state: { log: [] }, policy: model, fallback: auto, finish, limits: { ...limits, maxTurns: 3 } });
    expect(run.stop).toBe("finished");
    expect(run.fallbackReason).toBe("turns");
    expect(model.decide).toHaveBeenCalledTimes(3);
  });

  it("records why a finish was sent back, for diagnostics", async () => {
    const check = (f: { ok: boolean }) => (f.ok ? null : "Pick a hotel first.");
    const policy = scripted([
      { thought: "", actions: [], finish: { ok: false } },
      { thought: "", actions: [] },
      { thought: "", actions: [], finish: { ok: true } },
    ]);
    const run = await runAgent({ tools: [echo("a")], state: { log: [] }, policy, finish: { ...finish, check }, limits });
    expect(run.decisions.map((d) => d.note ?? null)).toEqual(["finish sent back: Pick a hotel first.", "no tool and no finish", null]);
    expect(run.fallbackReason).toBeNull();
  });

  it("stops at the deadline", async () => {
    const slow = defineTool<S, { q: string }>({ name: "slow", description: "", args: "{}", schema: z.object({ q: z.string() }), label: () => "slow", run: async () => new Promise((r) => setTimeout(() => r({ observation: "late", summary: "late" }), 60)) });
    const policy = scripted(Array.from({ length: 20 }, () => ({ thought: "", actions: [{ tool: "slow", args: { q: String(Math.random()) } }] })));
    const run = await runAgent({ tools: [slow], state: { log: [] }, policy, finish, limits: { maxTurns: 20, maxCalls: 20, deadlineMs: 100 } });
    expect(run.stop).toBe("deadline");
  });
});
