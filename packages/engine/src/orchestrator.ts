// Runs a graph of skills: each starts as soon as its dependencies succeed, independent skills
// run in parallel, a failure only skips the skills that depend on it, and every step is timed.
// Missions add two things: checkpoints (stop before a skill until the user approves) and
// seeds (results from an earlier phase of the same run, so resuming doesn't repeat work).
import { EngineError, OutputError } from "./errors";
import type { BriefInput, Skill, SkillContext, SkillResult, StepProgress } from "./types";
import { withTimeout } from "./util";

export type StepStatus = "succeeded" | "failed" | "skipped" | "waiting";

export type BriefEvent =
  | { type: "step.started"; skill: string; title: string; at: number }
  /** A running skill's live narration: what the agent is thinking and doing right now. */
  | { type: "step.progress"; skill: string; title: string; at: number; progress: StepProgress }
  | { type: "step.succeeded"; skill: string; title: string; ms: number; result: SkillResult<unknown>; cached?: boolean }
  | { type: "step.failed"; skill: string; title: string; ms: number; error: string }
  | { type: "step.skipped"; skill: string; title: string; reason: string }
  | { type: "step.waiting"; skill: string; title: string; reason: string };

export type BriefRun = {
  status: "succeeded" | "partial" | "failed" | "waiting";
  results: Record<string, SkillResult<unknown>>;
  steps: Record<string, { status: StepStatus; ms?: number; error?: string }>;
  ms: number;
};

export type RunOptions = {
  /** Skills that must not start until the user approves. They and their dependents report "waiting". */
  stopBefore?: Iterable<string>;
  /** Accepted results from an earlier phase of this run, reused instead of recomputed. */
  seed?: Record<string, SkillResult<unknown>>;
};

/** Throws if the graph has unknown dependencies or cycles. Optional deps outside the graph are ignored. */
export function validateGraph(skills: Skill<BriefInput, unknown>[]): void {
  const ids = new Set(skills.map((s) => s.id));
  if (ids.size !== skills.length) throw new Error("Duplicate skill ids");
  for (const s of skills) for (const d of s.dependsOn) if (!ids.has(d)) throw new Error(`Skill ${s.id} depends on unknown skill ${d}`);
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(skills.map((s) => [s.id, s]));
  const edges = (s: Skill<BriefInput, unknown>) => [...s.dependsOn, ...(s.optionalDeps ?? []).filter((d) => ids.has(d))];
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`Cycle in skill graph: ${[...path, id].join(" → ")}`);
    state.set(id, "visiting");
    for (const d of edges(byId.get(id)!)) visit(d, [...path, id]);
    state.set(id, "done");
  };
  for (const s of skills) visit(s.id, []);
}

export async function runBrief(
  skills: Skill<BriefInput, unknown>[],
  ctx: SkillContext,
  input: BriefInput,
  onEvent: (e: BriefEvent) => void = () => {},
  options: RunOptions = {}
): Promise<BriefRun> {
  validateGraph(skills);
  const started = Date.now();
  const byId = new Map(skills.map((s) => [s.id, s]));
  const stopBefore = new Set(options.stopBefore ?? []);
  const seed = options.seed ?? {};
  const results: Record<string, SkillResult<unknown>> = {};
  const steps: BriefRun["steps"] = {};
  const running = new Map<string, Promise<StepStatus>>();

  const emit = (e: BriefEvent) => {
    try {
      onEvent(e);
    } catch (err) {
      ctx.log.warn("onEvent handler threw", { error: String(err) });
    }
  };

  const launch = (id: string): Promise<StepStatus> => {
    const existing = running.get(id);
    if (existing) return existing;
    const skill = byId.get(id)!;
    const optional = (skill.optionalDeps ?? []).filter((d) => byId.has(d));
    const p = (async (): Promise<StepStatus> => {
      const [hard, soft] = await Promise.all([Promise.all(skill.dependsOn.map(launch)), Promise.all(optional.map(launch))]);

      const waitingOn = [...skill.dependsOn.filter((_, i) => hard[i] === "waiting"), ...optional.filter((_, i) => soft[i] === "waiting")];
      const blocked = skill.dependsOn.filter((_, i) => hard[i] === "failed" || hard[i] === "skipped");
      if (blocked.length > 0) {
        const reason = `Needs ${blocked.map((b) => byId.get(b)!.title.toLowerCase()).join(", ")}, which didn't complete.`;
        steps[id] = { status: "skipped", error: reason };
        emit({ type: "step.skipped", skill: id, title: skill.title, reason });
        return "skipped";
      }
      if (waitingOn.length > 0 || stopBefore.has(id)) {
        const reason = stopBefore.has(id) ? "Waiting for your go-ahead." : "Waiting on an earlier decision.";
        steps[id] = { status: "waiting", error: reason };
        emit({ type: "step.waiting", skill: id, title: skill.title, reason });
        return "waiting";
      }
      if (ctx.signal?.aborted) {
        steps[id] = { status: "skipped", error: "Cancelled." };
        emit({ type: "step.skipped", skill: id, title: skill.title, reason: "Cancelled." });
        return "skipped";
      }

      const seeded = seed[id];
      if (seeded) {
        const valid = skill.output.safeParse(seeded.data);
        if (valid.success) {
          results[id] = { ...seeded, data: valid.data };
          steps[id] = { status: "succeeded", ms: 0 };
          emit({ type: "step.succeeded", skill: id, title: skill.title, ms: 0, result: results[id], cached: true });
          return "succeeded";
        }
      }

      const t0 = Date.now();
      emit({ type: "step.started", skill: id, title: skill.title, at: t0 });
      try {
        const deps: Record<string, SkillResult<unknown>> = {};
        for (const d of skill.dependsOn) deps[d] = results[d];
        optional.forEach((d, i) => {
          if (soft[i] === "succeeded") deps[d] = results[d];
        });
        // Each skill gets its own progress channel, tagged with its id.
        const skillCtx: SkillContext = { ...ctx, progress: (progress) => emit({ type: "step.progress", skill: id, title: skill.title, at: Date.now(), progress }) };
        const result = await withTimeout(skill.run(skillCtx, input, deps), skill.timeoutMs, skill.id);
        const valid = skill.output.safeParse(result.data);
        if (!valid.success) throw new OutputError(`${skill.id} output failed validation: ${valid.error.issues[0]?.message ?? "invalid"}`);
        const accepted: SkillResult<unknown> = { ...result, data: valid.data };
        results[id] = accepted;
        const ms = Date.now() - t0;
        steps[id] = { status: "succeeded", ms };
        emit({ type: "step.succeeded", skill: id, title: skill.title, ms, result: accepted });
        return "succeeded";
      } catch (err) {
        const ms = Date.now() - t0;
        const message = err instanceof EngineError ? err.userMessage : "This step failed unexpectedly.";
        ctx.log.error("Skill failed", { skill: id, ms, error: err instanceof Error ? err.message : String(err) });
        steps[id] = { status: "failed", ms, error: message };
        emit({ type: "step.failed", skill: id, title: skill.title, ms, error: message });
        return "failed";
      }
    })();
    running.set(id, p);
    return p;
  };

  const statuses = await Promise.all(skills.map((s) => launch(s.id)));
  const ok = statuses.filter((s) => s === "succeeded").length;
  const status: BriefRun["status"] = statuses.includes("waiting")
    ? "waiting"
    : ok === skills.length
      ? "succeeded"
      : ok === 0
        ? "failed"
        : "partial";
  return { status, results, steps, ms: Date.now() - started };
}
