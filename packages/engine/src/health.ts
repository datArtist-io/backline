// A quick health check of each outside service, for /api/health: whether it answers, how fast,
// and the HTTP status when it doesn't. Never returns keys, prompts or content.
import { z } from "zod";
import { LlmClient } from "./clients/llm";
import { TavilyClient } from "./clients/tavily";
import { ClaudeSearchClient } from "./clients/claude-search";
import { QlooClient } from "./clients/qloo";
import { UpstreamError } from "./errors";
import { readEnv } from "./context";

export type ServiceCheck = { service: string; configured: boolean; ok: boolean | null; ms: number | null; status: number | null; detail: string | null };

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid url";
  }
};

/** What went wrong, without anything secret: the status code and a short, key-free message. */
function why(err: unknown): { status: number | null; detail: string } {
  const status = err instanceof UpstreamError ? err.status : null;
  const msg = err instanceof Error ? err.message : String(err);
  return { status, detail: msg.replace(/(sk|key|tvly|gsk|nb)[-_][A-Za-z0-9_-]{6,}/gi, "[key]").slice(0, 160) };
}

async function timed(service: string, configured: boolean, run: () => Promise<string | null>): Promise<ServiceCheck> {
  if (!configured) return { service, configured, ok: null, ms: null, status: null, detail: "not configured" };
  const t0 = Date.now();
  try {
    const detail = await run();
    return { service, configured, ok: true, ms: Date.now() - t0, status: 200, detail };
  } catch (err) {
    return { service, configured, ok: false, ms: Date.now() - t0, ...why(err) };
  }
}

/** Checks every configured AI model provider, web research provider and Qloo, in parallel. */
export async function checkServices(env: Record<string, string | undefined>): Promise<ServiceCheck[]> {
  const e = readEnv(env);
  const models = [
    { n: 1, key: e.LLM_API_KEY, base: e.LLM_BASE_URL, model: e.LLM_MODEL, fast: e.LLM_MODEL_FAST },
    { n: 2, key: e.LLM2_API_KEY, base: e.LLM2_BASE_URL, model: e.LLM2_MODEL, fast: e.LLM2_MODEL_FAST },
    { n: 3, key: e.LLM3_API_KEY, base: e.LLM3_BASE_URL, model: e.LLM3_MODEL, fast: e.LLM3_MODEL_FAST },
  ];
  const ping = z.object({ ok: z.boolean() });
  const checks: Promise<ServiceCheck>[] = [];
  for (const m of models) {
    for (const [tier, model] of [["default", m.model], ["fast", m.fast]] as const) {
      if (tier === "fast" && !model) continue;
      if (m.n > 1 && !m.key && !m.model) continue;
      checks.push(
        timed(`model ${m.n}${tier === "fast" ? " (fast)" : ""}: ${model ?? "no model set"} @ ${host(m.base)}`, Boolean(m.key && model), async () => {
          const c = new LlmClient({ apiKey: m.key!, baseUrl: m.base, models: { default: model! } });
          await c.json({ schema: ping, system: 'Reply with {"ok":true}.', user: "ping", maxTokens: 300, temperature: 0, timeoutMs: 20000, purpose: "health" });
          return null;
        })
      );
    }
  }
  checks.push(
    timed("research: Tavily", Boolean(e.TAVILY_API_KEY), async () => {
      const r = await new TavilyClient({ apiKey: e.TAVILY_API_KEY! }).search("Lisbon to London train or flight", { maxResults: 2, signal: AbortSignal.timeout(15000) });
      return `${r.length} results`;
    }),
    timed("research: Claude", Boolean(e.ANTHROPIC_API_KEY), async () => {
      const r = await new ClaudeSearchClient({ apiKey: e.ANTHROPIC_API_KEY!, model: e.CLAUDE_SEARCH_MODEL }).search("Lisbon weather in November", { maxResults: 2, need: "facts", signal: AbortSignal.timeout(25000) });
      return `${r.length} results`;
    }),
    timed("Qloo", Boolean(e.QLOO_API_KEY), async () => {
      const q = new QlooClient({ apiKey: e.QLOO_API_KEY, baseUrl: e.QLOO_API_URL });
      const r = await q.search("Lisbon", { take: 2, signal: AbortSignal.timeout(15000) });
      return `${r.length} results`;
    }),
    Promise.resolve({ service: "hotels: LiteAPI", configured: Boolean(e.LITEAPI_API_KEY), ok: null, ms: null, status: null, detail: e.LITEAPI_API_KEY ? (e.LITEAPI_API_KEY.startsWith("sand") ? "sandbox key (test bookings)" : "live key") : "not configured" }),
    Promise.resolve({ service: "flights: Duffel", configured: Boolean(e.DUFFEL_API_KEY), ok: null, ms: null, status: null, detail: e.DUFFEL_API_KEY ? (e.DUFFEL_API_KEY.startsWith("duffel_test") ? "test key (flights hidden)" : "live key") : "not configured" })
  );
  return Promise.all(checks);
}
