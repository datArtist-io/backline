import { describe, expect, it } from "vitest";
import { lastJson } from "../src/clients/claude-search";
import { ChainedWebSearch } from "../src/clients/chain";
import { UpstreamError } from "../src/errors";
import { normalizeTrip, rawTripSchema, validDate, CURRENCIES } from "../src/trip-request";
import { parsePrice } from "../src/skills/hotel-tiers";

describe("model answers with small slips still count", () => {
  it("reads numbers as text, 'per night', 'activity' and a currency symbol", () => {
    const r = rawTripSchema.parse({ destination: "Lisbon", adults: "2", budgetAmount: "1,500", currency: "£", budgetScope: "per night", needs: ["stay", "activity", "transport"], likes: "fado" });
    expect(r).toMatchObject({ adults: 2, budgetAmount: 1500, budgetScope: "per_night", needs: ["stay", "activities"], likes: ["fado"] });
    expect(normalizeTrip(r, null, {}, "2026-10-30")?.budget).toEqual({ amount: 1500, currency: "GBP", scope: "per_night" });
  });
});

describe("dates", () => {
  it("rejects days that don't exist and fixes a near-miss year", () => {
    expect(validDate("2026-02-30", "2026-01-01")).toBeNull();
    expect(validDate("2026-01-05", "2026-12-20")).toBe("2027-01-05");
    expect(validDate("2020-01-01", "2026-10-30")).toBeNull();
  });
});

describe("parsing", () => {
  it("never loops on broken JSON", () => {
    expect(lastJson('{"rate": 120,}')).toBeNull();
    expect(lastJson('text {"a":1} more')).toEqual({ a: 1 });
  });
  it("reads the price, not the dates or the total", () => {
    expect(parsePrice("Nov 14-16: from €150 per night", "EUR")).toMatchObject({ low: 150, high: 150 });
    expect(parsePrice("€120 per night (€360 for 3 nights)", "EUR")).toMatchObject({ low: 120, high: 120 });
    expect(parsePrice("₦45,000–60,000 per night", "NGN")).toMatchObject({ low: 45000, high: 60000 });
  });
  it("tells Lagos, Portugal from Lagos, Nigeria", () => {
    expect(CURRENCIES.find(([re]) => re.test("Lagos, Portugal"))?.[1]).toBe("EUR");
    expect(CURRENCIES.find(([re]) => re.test("Lagos, Nigeria"))?.[1]).toBe("NGN");
  });
});

describe("research chain", () => {
  it("says research is down when every paid provider failed", async () => {
    const paid = { provider: "paid", search: async () => { throw new UpstreamError("web", 402, "no credit"); } };
    const free = { provider: "wiki", search: async () => [] };
    await expect(new ChainedWebSearch([paid, free]).search("q")).rejects.toThrow();
  });
  it("still returns nothing found when a provider simply found nothing", async () => {
    const paid = { provider: "paid", search: async () => [] };
    const free = { provider: "wiki", search: async () => [] };
    expect(await new ChainedWebSearch([paid, free]).search("q")).toEqual([]);
  });
});
