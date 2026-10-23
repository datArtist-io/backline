import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runBrief, validateGraph, type BriefEvent } from "../src/orchestrator";
import { InputError } from "../src/errors";
import type { BriefInput, Skill } from "../src/types";
import { ctxWith } from "./helpers";

const skill = (id: string, dependsOn: string[], run: Skill<BriefInput, unknown>["run"], timeoutMs = 1000): Skill<BriefInput, unknown> => ({
  id,
  title: `Step ${id}`,
  dependsOn,
  timeoutMs,
  output: z.unknown(),
  run,
});

const ok = (value: unknown, ms = 0): Skill<BriefInput, unknown>["run"] => async () => {
  if (ms) await new Promise((r) => setTimeout(r, ms));
  return { data: value, evidence: [] };
};

describe("validateGraph", () => {
  it("rejects unknown dependencies and cycles", () => {
    expect(() => validateGraph([skill("a", ["missing"], ok(1))])).toThrow("unknown");
    expect(() => validateGraph([skill("a", ["b"], ok(1)), skill("b", ["a"], ok(1))])).toThrow("Cycle");
  });
});

describe("runBrief", () => {
  it("passes dependency outputs downstream", async () => {
    const run = await runBrief(
      [skill("a", [], ok(2)), skill("b", ["a"], async (_c, _i, deps) => ({ data: (deps.a.data as number) * 10, evidence: [] }))],
      ctxWith(),
      { artist: "x" }
    );
    expect(run.status).toBe("succeeded");
    expect(run.results.b.data).toBe(20);
  });

  it("runs independent skills in parallel", async () => {
    const t0 = Date.now();
    await runBrief([skill("a", [], ok(1, 60)), skill("b", [], ok(1, 60)), skill("c", [], ok(1, 60))], ctxWith(), { artist: "x" });
    expect(Date.now() - t0).toBeLessThan(150);
  });

  it("skips only the skills that depend on a failure", async () => {
    const events: BriefEvent[] = [];
    const run = await runBrief(
      [
        skill("a", [], async () => {
          throw new InputError("bad input");
        }),
        skill("b", ["a"], ok(1)),
        skill("c", [], ok(1)),
      ],
      ctxWith(),
      { artist: "x" },
      (e) => events.push(e)
    );
    expect(run.status).toBe("partial");
    expect(run.steps.a).toMatchObject({ status: "failed", error: "bad input" });
    expect(run.steps.b.status).toBe("skipped");
    expect(run.steps.c.status).toBe("succeeded");
    expect(events.map((e) => e.type)).toContain("step.skipped");
  });

  it("stops a step that runs past its time budget", async () => {
    const run = await runBrief([skill("slow", [], ok(1, 200), 20)], ctxWith(), { artist: "x" });
    expect(run.steps.slow.status).toBe("failed");
    expect(run.status).toBe("failed");
  });

  it("rejects output that fails the skill's schema", async () => {
    const strict: Skill<BriefInput, unknown> = { ...skill("s", [], ok("not a number")), output: z.number() };
    const run = await runBrief([strict], ctxWith(), { artist: "x" });
    expect(run.steps.s.status).toBe("failed");
  });

  it("hides internal error details from users", async () => {
    const run = await runBrief(
      [
        skill("x", [], async () => {
          throw new Error("secret stack detail");
        }),
      ],
      ctxWith(),
      { artist: "x" }
    );
    expect(run.steps.x.error).toBe("This step failed unexpectedly.");
  });
});
