import { describe, expect, it } from "vitest";
import type { ServiceCheck } from "@backline/engine";
import { bearerMatches, publicHealth } from "../src/lib/health-view";

const svc = (service: string, ok: boolean | null, configured = true): ServiceCheck => ({ service, configured, ok, ms: 100, status: ok === false ? 401 : 200, detail: null });

describe("Public health", () => {
  it("says up or down without naming any provider, model or host", () => {
    const h = publicHealth([svc("model 1: some-model @ api.example.com", true), svc("research: Claude", false), svc("Qloo", true)], "2026-11-08T00:00:00Z");
    expect(h).toEqual({ ok: false, core: true, at: "2026-11-08T00:00:00Z" });
    expect(JSON.stringify(h)).not.toMatch(/Claude|model|example|Qloo/);
  });

  it("marks the core down when Qloo fails or every configured model fails", () => {
    expect(publicHealth([svc("model 1: a", true), svc("Qloo", false)], "t").core).toBe(false);
    expect(publicHealth([svc("model 1: a", false), svc("model 2: b", false), svc("Qloo", true)], "t").core).toBe(false);
    expect(publicHealth([svc("model 1: a", false), svc("model 2: b", true), svc("Qloo", true)], "t").core).toBe(true);
    expect(publicHealth([svc("model 1: a", null, false), svc("Qloo", true)], "t")).toEqual({ ok: true, core: true, at: "t" });
  });
});

describe("Health token", () => {
  it("only accepts the exact bearer token, and nothing when no token is set", () => {
    expect(bearerMatches("Bearer s3cret-token", "s3cret-token")).toBe(true);
    expect(bearerMatches("Bearer s3cret-tokeX", "s3cret-token")).toBe(false);
    expect(bearerMatches("Bearer s3cret", "s3cret-token")).toBe(false);
    expect(bearerMatches("s3cret-token", "s3cret-token")).toBe(false);
    expect(bearerMatches(null, "s3cret-token")).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer anything", undefined)).toBe(false);
  });
});
