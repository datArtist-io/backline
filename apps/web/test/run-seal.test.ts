import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRun, sealRun, type Sealed } from "../src/lib/run-seal";

const run = (): Sealed => ({ runId: "11111111-2222-3333-4444-555555555555", plan: { goal: "Dinner" } as never, results: { "trip.plan": { data: { pick: "NOK by Alara" }, evidence: [] } }, at: Date.now() });

describe("run seal", () => {
  beforeEach(() => {
    process.env.RUN_SEAL_KEY = "test-key-0123456789abcdef";
  });
  afterEach(() => {
    delete process.env.RUN_SEAL_KEY;
  });
  it("round-trips the exact plan the person saw", () => {
    const s = run();
    const seal = sealRun(s)!;
    expect(openRun(seal, s.runId)).toEqual(s);
  });
  it("rejects a tampered plan, another run's seal, and an expired seal", () => {
    const s = run();
    const seal = sealRun(s)!;
    const [body, sig] = seal.split(".");
    const flipped = body.slice(0, 20) + (body[20] === "x" ? "y" : "x") + body.slice(21);
    expect(openRun(`${flipped}.${sig}`, s.runId)).toBeNull();
    expect(openRun(seal, "99999999-2222-3333-4444-555555555555")).toBeNull();
    expect(openRun(seal, s.runId, Date.now() + 3 * 60 * 60_000)).toBeNull();
    expect(openRun(undefined, s.runId)).toBeNull();
  });
  it("won't seal without a server key", () => {
    delete process.env.RUN_SEAL_KEY;
    const saved = { a: process.env.SUPABASE_SECRET_KEY, b: process.env.TRAVEL_DOCS_KEY };
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.TRAVEL_DOCS_KEY;
    expect(sealRun(run())).toBeNull();
    Object.assign(process.env, saved.a ? { SUPABASE_SECRET_KEY: saved.a } : {}, saved.b ? { TRAVEL_DOCS_KEY: saved.b } : {});
  });
});
