// Holds a mission's accepted step results between phases (before and after a checkpoint),
// so resuming doesn't repeat work. In-memory and per server instance; when a resume lands on a
// different instance, the sealed copy the browser sends back (run-seal.ts) is used instead, and an
// approval is never applied to a re-planned run.
import type { Plan, SkillResult } from "@backline/engine";

type Stored = { plan: Plan; results: Record<string, SkillResult<unknown>>; at: number };

const TTL_MS = 30 * 60_000;
const MAX = 300;
const g = globalThis as unknown as { __runs?: Map<string, Stored> };
const runs = (g.__runs ??= new Map());

export function getRun(id: string): Stored | null {
  const r = runs.get(id);
  if (!r) return null;
  if (Date.now() - r.at > TTL_MS) {
    runs.delete(id);
    return null;
  }
  return r;
}

export function saveRun(id: string, plan: Plan, results: Record<string, SkillResult<unknown>>): void {
  runs.delete(id);
  runs.set(id, { plan, results, at: Date.now() });
  while (runs.size > MAX) {
    const oldest = runs.keys().next().value;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
}

export const isRunId = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
