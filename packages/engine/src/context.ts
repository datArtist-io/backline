// Builds a SkillContext from environment variables. Validated at startup so a missing key
// fails loudly and early, not halfway through a mission.
import { z } from "zod";
import { QlooClient } from "./clients/qloo";
import { LlmClient } from "./clients/llm";
import { TavilyClient } from "./clients/tavily";
import { ResendSender, type EmailSender } from "./clients/email";
import { VapiCaller, type CallPlacer } from "./clients/calls";
import { OsmClient } from "./clients/osm";
import { WikiSearchClient } from "./clients/wiki";
import { ClaudeSearchClient } from "./clients/claude-search";
import { LiteApiProvider } from "./clients/liteapi";
import { DuffelClient } from "./clients/duffel";
import type { HotelProvider } from "./clients/hotels";
import { ChainedWebSearch } from "./clients/chain";
import type { WebSearch } from "./clients/web";
import type { Logger, SkillContext, UsageMeter } from "./types";

const envSchema = z.object({
  QLOO_API_KEY: z.string().min(10, "QLOO_API_KEY is missing"),
  QLOO_API_URL: z.string().url().default("https://hackathon.api.qloo.com"),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().url().default("https://api.tokenfactory.nebius.com/v1"),
  LLM_MODEL: z.string().optional(),
  LLM_MODEL_FAST: z.string().optional(),
  LLM_MODEL_STRONG: z.string().optional(),
  /** Optional JSON merged into every model request, e.g. {"chat_template_kwargs":{"enable_thinking":false}}. */
  LLM_EXTRA_BODY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  WEB_SEARCH_PROVIDER: z.enum(["claude", "tavily"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Model for Claude web search (default claude-haiku-5-5: fast and inexpensive). */
  CLAUDE_SEARCH_MODEL: z.string().optional(),
  /** "off" turns research off entirely; otherwise free Wikivoyage/Wikipedia research is always there. */
  WEB_SEARCH: z.enum(["on", "off"]).default("on"),
  // Acting on the user's behalf (both optional; without them the agent prepares and the user sends).
  RESEND_API_KEY: z.string().optional(),
  ACTIONS_FROM_EMAIL: z.string().optional(),
  VAPI_API_KEY: z.string().optional(),
  VAPI_PHONE_NUMBER_ID: z.string().optional(),
  VAPI_MODEL: z.string().optional(),
  /** LiteAPI key for live hotel rates and booking. A sandbox key (sand_…) simulates payment. */
  LITEAPI_API_KEY: z.string().optional(),
  /** Duffel token for flight search and booking. A test token (duffel_test_…) books on Duffel's test airline. */
  DUFFEL_API_KEY: z.string().optional(),
  // Maps (OpenStreetMap: geocoding, nearby places, road routes). No key needed; "off" disables.
  MAPS: z.enum(["on", "off"]).default("on"),
  OSM_USER_AGENT: z.string().optional(),
  OSM_CONTACT_EMAIL: z.string().optional(),
});

export type EngineEnv = z.infer<typeof envSchema>;

export function readEnv(env: Record<string, string | undefined>): EngineEnv {
  const clean = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = envSchema.safeParse(clean);
  if (!parsed.success) throw new Error(`Engine configuration error: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}

export const consoleLogger: Logger = {
  // Never log keys, prompts with user content or Qloo payloads (SECURITY.md).
  info: (msg, meta) => console.info(`[engine] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[engine] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[engine] ${msg}`, meta ?? ""),
};

export function createUsageMeter(): UsageMeter {
  const totals: Record<string, number> = {};
  return {
    add: (kind, units) => {
      totals[kind] = (totals[kind] ?? 0) + units;
    },
    snapshot: () => ({ ...totals }),
  };
}

/**
 * Research providers in order: Claude web search and Tavily when their keys are set
 * (WEB_SEARCH_PROVIDER picks which goes first), then Wikivoyage and Wikipedia, which are free and
 * need no key. A provider that's out of credit hands over to the next. WEB_SEARCH=off turns research off.
 */
function pickWebSearch(e: EngineEnv, claude: ClaudeSearchClient | null): WebSearch | null {
  if (e.WEB_SEARCH === "off") return null;
  const tavily = e.TAVILY_API_KEY ? new TavilyClient({ apiKey: e.TAVILY_API_KEY }) : null;
  const keyed = (e.WEB_SEARCH_PROVIDER === "tavily" ? [tavily, claude] : [claude, tavily]).filter((p): p is ClaudeSearchClient | TavilyClient => p !== null);
  const ua = e.OSM_USER_AGENT || `Backline/1.0 (trip planning agent${e.OSM_CONTACT_EMAIL ? `; ${e.OSM_CONTACT_EMAIL}` : ""})`;
  return new ChainedWebSearch([...keyed, new WikiSearchClient({ userAgent: ua })]);
}

/** What the agent can actually do on the user's behalf in this deployment. */
export function capabilities(env: Record<string, string | undefined>): { email: boolean; calls: boolean; web: boolean; maps: boolean } {
  const e = readEnv(env);
  return { email: Boolean(e.RESEND_API_KEY && e.ACTIONS_FROM_EMAIL), calls: Boolean(e.VAPI_API_KEY && e.VAPI_PHONE_NUMBER_ID), web: e.WEB_SEARCH !== "off", maps: e.MAPS !== "off" };
}

/** LLM_EXTRA_BODY as an object, or undefined if it's missing or not a JSON object (ignored with a warning). */
function parseExtraBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  console.warn("[engine] LLM_EXTRA_BODY isn't a JSON object, so it's ignored.");
  return undefined;
}

type Shared = { key: string; qloo: QlooClient; llm: LlmClient | null; web: WebSearch | null; rates: ClaudeSearchClient | null; email: EmailSender | null; calls: CallPlacer | null; osm: OsmClient | null; hotels: HotelProvider | null; flights: DuffelClient | null };

// Clients are reused across requests in the same server process so their caches are shared.
let shared: Shared | null = null;

export function createContext(env: Record<string, string | undefined>, opts: { log?: Logger; signal?: AbortSignal } = {}): SkillContext {
  const e = readEnv(env);
  const key = JSON.stringify([
    e.QLOO_API_KEY.slice(-6),
    e.LLM_BASE_URL,
    e.LLM_MODEL,
    e.LLM_MODEL_FAST,
    e.LLM_MODEL_STRONG,
    e.LLM_EXTRA_BODY,
    e.MAPS,
    Boolean(e.TAVILY_API_KEY),
    Boolean(e.ANTHROPIC_API_KEY),
    e.CLAUDE_SEARCH_MODEL,
    e.WEB_SEARCH_PROVIDER,
    e.WEB_SEARCH,
    Boolean(e.RESEND_API_KEY),
    e.ACTIONS_FROM_EMAIL,
    Boolean(e.VAPI_API_KEY),
    e.VAPI_PHONE_NUMBER_ID,
    e.LITEAPI_API_KEY?.slice(0, 5),
    e.DUFFEL_API_KEY?.slice(0, 12),
  ]);
  if (!shared || shared.key !== key) {
    const claude = e.ANTHROPIC_API_KEY ? new ClaudeSearchClient({ apiKey: e.ANTHROPIC_API_KEY, model: e.CLAUDE_SEARCH_MODEL }) : null;
    shared = {
      rates: claude,
      key,
      qloo: new QlooClient({ apiKey: e.QLOO_API_KEY, baseUrl: e.QLOO_API_URL }),
      llm:
        e.LLM_API_KEY && e.LLM_MODEL
          ? new LlmClient({ apiKey: e.LLM_API_KEY, baseUrl: e.LLM_BASE_URL, models: { default: e.LLM_MODEL, fast: e.LLM_MODEL_FAST, strong: e.LLM_MODEL_STRONG }, extraBody: parseExtraBody(e.LLM_EXTRA_BODY) })
          : null,
      web: pickWebSearch(e, claude),
      email: e.RESEND_API_KEY && e.ACTIONS_FROM_EMAIL ? new ResendSender({ apiKey: e.RESEND_API_KEY, from: e.ACTIONS_FROM_EMAIL }) : null,
      calls: e.VAPI_API_KEY && e.VAPI_PHONE_NUMBER_ID ? new VapiCaller({ apiKey: e.VAPI_API_KEY, phoneNumberId: e.VAPI_PHONE_NUMBER_ID, model: e.VAPI_MODEL }) : null,
      osm: e.MAPS === "off" ? null : new OsmClient({ userAgent: e.OSM_USER_AGENT, email: e.OSM_CONTACT_EMAIL }),
      hotels: e.LITEAPI_API_KEY ? new LiteApiProvider({ apiKey: e.LITEAPI_API_KEY }) : null,
      flights: e.DUFFEL_API_KEY ? new DuffelClient({ token: e.DUFFEL_API_KEY }) : null,
    };
  }
  return {
    qloo: shared.qloo,
    llm: shared.llm,
    web: shared.web,
    rates: shared.rates,
    email: shared.email,
    calls: shared.calls,
    osm: shared.osm,
    hotels: shared.hotels,
    flights: shared.flights,
    log: opts.log ?? consoleLogger,
    usage: createUsageMeter(),
    signal: opts.signal,
  };
}
