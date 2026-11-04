// One lookup per run, whoever asks first. The agent calls tools like "find_travel" when it decides it
// needs them; the fixed steps that follow reuse those answers instead of fetching again, and only do
// the work themselves when the agent didn't (a guarantee, not a second copy). Scoped to the run's input
// object, so separate runs never share results.
import type { TripRequest } from "../types";

const runs = new WeakMap<object, Map<string, Promise<unknown>>>();

export function shared<T>(scope: object, key: string, make: () => Promise<T>): Promise<T> {
  let m = runs.get(scope);
  if (!m) runs.set(scope, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit as Promise<T>;
  const p = make();
  m.set(key, p);
  // A failed lookup may be tried again by whoever asks next.
  p.catch(() => m!.get(key) === p && m!.delete(key));
  return p;
}

/** Whether a lookup has been started this run. */
export function started(scope: object, key: string): boolean {
  return runs.get(scope)?.has(key) ?? false;
}

/** The part of a trip a lookup depends on, so a changed trip asks again. Pure. */
export function tripKey(kind: string, t: Pick<TripRequest, "destination" | "startDate" | "endDate" | "adults"> & { origin?: string | null }, extra = ""): string {
  return [kind, (t.origin ?? "").toLowerCase(), t.destination.toLowerCase(), t.startDate ?? "", t.endDate ?? "", t.adults, extra].join("|");
}
