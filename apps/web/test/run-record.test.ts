import { describe, expect, it } from "vitest";
import { runRecord } from "../src/lib/ops";

const agent = {
  trip: { destination: "Singapore", origin: "Atlanta, United States", startDate: "2027-03-02", endDate: "2027-03-09", adults: 2, budget: { amount: 7000, currency: "USD" } },
  method: "agent",
  stats: { turns: 6, calls: 14, stop: "finished", trace: [{ by: "model", calls: [{ tool: "search_places", ok: true, ms: 900 }, { tool: "find_travel", ok: false, ms: 300 }] }, { by: "model", note: "finish sent back: travel not checked", calls: [{ tool: "find_travel", ok: true, ms: 1200 }] }] },
};

describe("the run record", () => {
  it("sums tools, reads the price sources and keeps nothing personal", () => {
    const r = runRecord({
      runId: "r1",
      source: "web",
      results: {
        "trip.agent": { data: agent },
        "trip.actions": { data: { actions: [{ kind: "book_travel", subject: "Estimated fare: the live Google Flights fare replaces it when found" }] } },
        "trip.plan": { data: { budget: [{ item: "Harbour House, 7 nights", basis: "rate listed on booking.com" }] } },
      },
      steps: { "trip.events": { status: "failed" }, "trip.agent": { status: "succeeded" } },
      status: "succeeded",
      ms: 41_200,
      llmCalls: [{ model: "nemotron", ok: false }, { model: "gpt-oss", ok: true }],
      signedIn: true,
      country: "NG",
    });
    expect(r.request).toEqual({ city: "Singapore", origin: "Atlanta", days: 8, travellers: 2, budget: 7000, currency: "USD" });
    expect(r.tools).toEqual({ search_places: { calls: 1, fail: 0, ms: 900 }, find_travel: { calls: 2, fail: 1, ms: 1500 } });
    expect(r.finish_sent_back).toBe(1);
    expect(r.prices).toEqual({ flight: "estimate", hotel: "listed" });
    expect(r.model).toEqual({ used: "gpt-oss", calls: 2, failed: 1, failovers: 0 });
    expect(r.steps.failed).toEqual(["trip.events"]);
    expect(r.outcome).toBe("succeeded");
    expect(JSON.stringify(r)).not.toMatch(/@|\+\d{6,}/);
  });
  it("marks an autopilot run and survives missing steps", () => {
    const r = runRecord({ runId: "r2", source: "voice", results: { "trip.agent": { data: { ...agent, method: "autopilot" } } }, steps: {}, status: "succeeded", ms: 10, llmCalls: [], signedIn: false, country: null });
    expect(r.autopilot).toBe(true);
    expect(r.outcome).toBe("autopilot");
    expect(r.prices).toEqual({ flight: "none", hotel: "none" });
    expect(r.model.used).toBeNull();
  });
});
