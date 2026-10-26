// The chat client looking after itself: switching thinking off or resting a tier that keeps failing. All responses here are synthetic.
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmClient } from "../src/clients/llm";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const orig = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = orig;
});

type Seen = { url: string; body: Record<string, unknown> | null };
function fakeFetch(handler: (url: string, body: Record<string, unknown> | null) => Response): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    seen.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
  return seen;
}

describe("a chat model that thinks too long", () => {
  const schema = z.object({ ok: z.boolean() });
  const cutOff = () => json({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
  const answer = () => json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] });

  it("switches thinking off when a thinking model runs out of tokens, and keeps it off", async () => {
    const seen = fakeFetch((_url, body) => ((body?.chat_template_kwargs as { enable_thinking?: boolean } | undefined)?.enable_thinking === false ? answer() : cutOff()));
    const llm = new LlmClient({ apiKey: "k", baseUrl: "https://llm.example/v1", models: { default: "nvidia/nemotron-3-super" } });
    expect(await llm.json({ system: "s", user: "u", schema, maxTokens: 400 })).toEqual({ ok: true });
    expect(seen.map((s) => [s.body?.max_tokens, Boolean(s.body?.chat_template_kwargs)])).toEqual([
      [400, false],
      [800, true],
    ]);
    await llm.json({ system: "s", user: "u", schema });
    expect(seen[2].body?.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("asks again without the switch when the provider refuses it, and remembers", async () => {
    const seen = fakeFetch((_url, body) => {
      if (body?.chat_template_kwargs) return json({ error: { message: "chat_template_kwargs: Extra inputs are not permitted" } }, 400);
      return seen.length <= 1 ? cutOff() : answer();
    });
    const llm = new LlmClient({ apiKey: "k", baseUrl: "https://llm.example/v1", models: { default: "qwen3-32b" } });
    expect(await llm.json({ system: "s", user: "u", schema })).toEqual({ ok: true });
    expect(seen.map((s) => Boolean(s.body?.chat_template_kwargs))).toEqual([false, true, false]);
    await llm.json({ system: "s", user: "u", schema });
    expect(seen[3].body?.chat_template_kwargs).toBeUndefined();
  });

  it("asks again with more room when an answer is cut off mid-JSON, instead of asking for a repair", async () => {
    const seen = fakeFetch((_url, body) =>
      (body?.max_tokens as number) < 1000 ? json({ choices: [{ message: { content: '{"ok": tr' }, finish_reason: "length" }] }) : answer()
    );
    const llm = new LlmClient({ apiKey: "k", baseUrl: "https://llm.example/v1", models: { default: "nvidia/nemotron-3-super" } });
    expect(await llm.json({ system: "s", user: "u", schema, maxTokens: 600 })).toEqual({ ok: true });
    expect(seen.map((s) => [s.body?.max_tokens, (s.body?.messages as unknown[]).length, Boolean(s.body?.chat_template_kwargs)])).toEqual([
      [600, 2, false],
      [1200, 2, true],
    ]);
  });

  it("rests a cheaper tier that keeps failing and uses the main model meanwhile", async () => {
    const seen = fakeFetch((_url, body) => (body?.model === "tiny" ? cutOff() : answer()));
    const llm = new LlmClient({ apiKey: "k", baseUrl: "https://llm.example/v1", models: { default: "main", fast: "tiny" } });
    await expect(llm.json({ tier: "fast", system: "s", user: "u", schema })).rejects.toThrow();
    expect(llm.modelFor("fast")).toBe("main");
    expect(llm.resting().map((r) => r.tier)).toEqual(["fast"]);
    expect(await llm.json({ tier: "fast", system: "s", user: "u", schema })).toEqual({ ok: true });
    expect(seen.map((s) => s.body?.model)).toEqual(["tiny", "tiny", "main"]);
  });
});
