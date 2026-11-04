import { afterEach, describe, expect, it } from "vitest";
import { QlooClient } from "../src/clients/qloo";

describe("Qloo requests", () => {
  const orig = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = orig;
  });
  it("never sends more than 5 at once, and still answers all of them", async () => {
    let now = 0;
    let peak = 0;
    globalThis.fetch = (async () => {
      now += 1;
      peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, 20));
      now -= 1;
      return new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 });
    }) as typeof fetch;
    const q = new QlooClient({ apiKey: "k" });
    const all = await Promise.all(Array.from({ length: 12 }, (_, i) => q.search(`query ${i}`)));
    expect(all).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(5);
  });
});
