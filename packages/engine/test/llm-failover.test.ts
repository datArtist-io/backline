import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FailoverLlm } from "../src/clients/llm-failover";

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { total_tokens: 5 } }), { status: 200 });
const cfg = (n: number) => ({ apiKey: `key${n}`, baseUrl: `https://p${n}.test/v1`, models: { default: `model-${n}` } });
const schema = z.object({ a: z.number() });
const req = { schema, system: "s", user: "u" };

afterEach(() => vi.unstubAllGlobals());

describe("failover between AI providers", () => {
  it("uses the next provider when the first is out of credit, then stops asking the first", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return String(url).includes("p1.test") ? new Response("payment required", { status: 402 }) : ok('{"a":1}');
    });
    const llm = new FailoverLlm([cfg(1), cfg(2)]);
    expect(await llm.json(req)).toEqual({ a: 1 });
    expect(llm.lastUsed).toBe(1);
    const before = calls.filter((c) => c.includes("p1.test")).length;
    expect(await llm.json(req)).toEqual({ a: 1 });
    expect(calls.filter((c) => c.includes("p1.test")).length).toBe(before);
    expect(llm.modelFor("default")).toBe("model-2");
  });
  it("tries the next provider when the first keeps returning unusable JSON", async () => {
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("p1.test") ? ok("not json at all") : ok('{"a":2}')));
    const llm = new FailoverLlm([cfg(1), cfg(2)]);
    expect(await llm.json(req)).toEqual({ a: 2 });
  });
  it("throws the last error when every provider fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 402 }));
    const llm = new FailoverLlm([cfg(1), cfg(2)]);
    await expect(llm.json(req)).rejects.toThrow();
  });
  it("keeps the first provider when it works", async () => {
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("p1.test") ? ok('{"a":3}') : ok('{"a":9}')));
    const llm = new FailoverLlm([cfg(1), cfg(2)]);
    expect(await llm.json(req)).toEqual({ a: 3 });
    expect(llm.lastUsed).toBe(0);
  });
});
