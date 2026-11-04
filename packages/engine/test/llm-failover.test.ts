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

describe("a native tool call the provider refused", () => {
  it("is recovered as the agent's decision", async () => {
    const { recoverToolCall } = await import("../src/clients/llm");
    const body = (g: string) => JSON.stringify({ error: { message: "Tool choice is none, but model called a tool", code: "tool_use_failed", failed_generation: g } });
    expect(JSON.parse(recoverToolCall(body('{"name": "search_places", "arguments": {"kind": "stay", "query": "jazz"}}'))!)).toEqual({ thought: "Using search places", actions: [{ tool: "search_places", args: { kind: "stay", query: "jazz" } }] });
    expect(JSON.parse(recoverToolCall(body('[{"name":"locate","arguments":"{\\"query\\":\\"Rome\\",\\"role\\":\\"city\\"}"},{"name":"find_travel","parameters":{}}]'))!).actions.map((a: { tool: string }) => a.tool)).toEqual(["locate", "find_travel"]);
    expect(JSON.parse(recoverToolCall(body('<function=check_places>{"ids":["s1"]}</function>'))!).actions[0]).toEqual({ tool: "check_places", args: { ids: ["s1"] } });
    expect(JSON.parse(recoverToolCall(body('{"thought":"done","finish":{"summary":"x"}}'))!).finish).toEqual({ summary: "x" });
    expect(recoverToolCall(body("just words"))).toBeNull();
    expect(recoverToolCall("not json")).toBeNull();
  });
});

describe("the client, when the provider refuses a tool call", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("answers with the recovered call instead of failing the turn", async () => {
    const { LlmClient } = await import("../src/clients/llm");
    const refused = JSON.stringify({ error: { message: "Tool choice is none, but model called a tool", type: "invalid_request_error", code: "tool_use_failed", failed_generation: '{"name":"find_events","arguments":{}}' } });
    const f = vi.fn(async () => new Response(refused, { status: 400 }));
    vi.stubGlobal("fetch", f);
    const llm = new LlmClient({ apiKey: "k", baseUrl: "https://llm.example/v1", models: { default: "m" } });
    const out = await llm.json({ system: "s", user: "u", schema: z.record(z.unknown()) });
    expect(out).toEqual({ thought: "Using find events", actions: [{ tool: "find_events", args: {} }] });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
