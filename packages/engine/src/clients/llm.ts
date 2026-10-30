// Chat client for any OpenAI-compatible provider (Nebius Token Factory, Groq, NVIDIA, OpenAI…).
// Every call returns JSON validated against a Zod schema, with one repair attempt. It looks after
// itself in production:
// - a tier whose model the provider doesn't serve falls back to the main model (logged once);
// - an answer cut off while the model was still thinking is retried with more room and, for models
//   that think by default, with thinking switched off (remembered per model if the provider accepts it);
// - a cheaper tier that keeps failing (cut off, timing out) is rested for a while, so callers stop
//   paying for it;
// - every call is recorded (timing and outcome, never content) so slow or failing models can be diagnosed.
import { z } from "zod";
import { OutputError, UpstreamError } from "../errors";
import { withRetry } from "../util";

export type ModelTier = "fast" | "default" | "strong";

export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  models: { default: string; fast?: string; strong?: string };
  timeoutMs?: number;
  /** Extra fields for every request body, e.g. {"chat_template_kwargs":{"enable_thinking":false}}. */
  extraBody?: Record<string, unknown>;
};

export type JsonRequest<T> = {
  tier?: ModelTier;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Overall time budget for this request, including the repair attempt. */
  timeoutMs?: number;
  /** A short label for diagnostics, e.g. "agent turn" or "plan". */
  purpose?: string;
};

/** What one model call did. Content is never recorded. */
export type LlmCallRecord = {
  at: number;
  purpose: string | null;
  tier: ModelTier;
  model: string;
  ms: number;
  ok: boolean;
  status: number | null;
  /** The provider's finish reason ("stop", "length"…). */
  finish: string | null;
  inChars: number;
  outChars: number;
  error: string | null;
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Pull the first JSON object or array out of model text (tolerates reasoning tags and code fences). */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const starts = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("No JSON found in model output");
  const start = Math.min(...starts);
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error("Unterminated JSON in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const MODEL_MISSING = /model[\s\S]{0,80}(not found|does not exist|doesn't exist|unknown|invalid|not supported|unavailable)|(no such|unknown) model/i;
/** A provider refusing the chat_template_kwargs field. */
const KWARGS_REFUSED = /chat_template|enable_thinking|extra (fields|inputs)|unrecognized|not permitted|unexpected (field|keyword|argument)/i;
/** Models that reason before answering unless told not to. */
const THINKS_BY_DEFAULT = /nemotron|qwen3|deepseek-r1|gpt-oss|magistral|glm-4\.[5-9]|kimi-k2-thinking/i;

const STRIKE_WINDOW_MS = 10 * 60_000;
const REST_MS = 15 * 60_000;

type Reply = { content: string; finish: string | null };

class CutOff extends OutputError {
  constructor(public readonly reason: "length" | "empty") {
    super(reason === "length" ? "The model ran out of tokens before answering." : "The model returned an empty answer.");
  }
}

export class LlmClient {
  private readonly base: string;
  private tokens = 0;
  private readonly broken = new Set<ModelTier>();
  private readonly records: LlmCallRecord[] = [];
  /** Per model: whether switching thinking off through the chat template works (true) or was refused (false). */
  private readonly thinkSwitch = new Map<string, boolean>();
  private readonly strikes = new Map<ModelTier, { n: number; first: number }>();
  private readonly restedUntil = new Map<ModelTier, number>();

  constructor(private readonly config: LlmConfig) {
    if (!config.apiKey || !config.models.default) throw new Error("LlmClient requires an API key and a default model");
    this.base = config.baseUrl.replace(/\/$/, "");
  }

  get tokenCount(): number {
    return this.tokens;
  }

  /** The model a tier uses right now: its own, or the main model if it isn't served or is resting. */
  modelFor(tier: ModelTier = "default"): string {
    const own = this.config.models[tier];
    if (tier === "default" || !own || this.broken.has(tier) || (this.restedUntil.get(tier) ?? 0) > Date.now()) return this.config.models.default;
    return own;
  }

  /** Tiers currently resting after repeated failures, with when they come back (diagnostics). */
  resting(): { tier: ModelTier; until: number }[] {
    const now = Date.now();
    return [...this.restedUntil].filter(([, until]) => until > now).map(([tier, until]) => ({ tier, until }));
  }

  /** Recent calls (newest last), optionally only those since a time. For diagnostics. */
  recentCalls(sinceMs = 0): LlmCallRecord[] {
    return this.records.filter((r) => r.at >= sinceMs);
  }

  private record(r: Omit<LlmCallRecord, "at">) {
    this.records.push({ at: Date.now(), ...r });
    if (this.records.length > 300) this.records.splice(0, this.records.length - 300);
  }

  /** Count a failure against a cheaper tier; two within ten minutes rest it for fifteen. */
  private strike(tier: ModelTier, model: string, why: string) {
    if (tier === "default" || model === this.config.models.default) return;
    const now = Date.now();
    const prev = this.strikes.get(tier);
    const cur = prev && now - prev.first < STRIKE_WINDOW_MS ? { n: prev.n + 1, first: prev.first } : { n: 1, first: now };
    if (cur.n < 2) {
      this.strikes.set(tier, cur);
      return;
    }
    this.strikes.delete(tier);
    this.restedUntil.set(tier, now + REST_MS);
    console.warn(`[engine] The ${tier} model "${model}" keeps failing (${why}), so the main model is used for the next 15 minutes.`);
  }

  private async callModel(model: string, tier: ModelTier, messages: ChatMessage[], maxTokens: number, temperature: number, signal: AbortSignal | undefined, purpose: string | null, thinkOff: boolean): Promise<Reply> {
    const inChars = messages.reduce((n, m) => n + m.content.length, 0);
    return withRetry(
      async () => {
        const t0 = Date.now();
        const base = { purpose, tier, model, inChars };
        const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 30000);
        const s = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let res: Response;
        try {
          res = await fetch(`${this.base}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
            body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, ...(thinkOff ? { chat_template_kwargs: { enable_thinking: false } } : {}), ...(this.config.extraBody ?? {}) }),
            signal: s,
          });
        } catch (err) {
          const reason = (s.reason ?? err) as { name?: string };
          const timedOut = reason?.name === "TimeoutError" || (err as Error).name === "TimeoutError";
          const aborted = timedOut || (err as Error).name === "AbortError";
          this.record({ ...base, ms: Date.now() - t0, ok: false, status: null, finish: null, outChars: 0, error: timedOut ? "timed out" : aborted ? "cancelled" : (err as Error).message.slice(0, 160) });
          if (timedOut) this.strike(tier, model, "timing out");
          throw new UpstreamError("llm", null, `LLM network error: ${(err as Error).message}`);
        }
        if (!res.ok) {
          const body = (await res.text().catch(() => "")).slice(0, 300);
          const missing = res.status === 404 || (res.status === 400 && MODEL_MISSING.test(body));
          this.record({ ...base, ms: Date.now() - t0, ok: false, status: res.status, finish: null, outChars: 0, error: body.replace(/\s+/g, " ").slice(0, 160) || `HTTP ${res.status}` });
          if (thinkOff && res.status === 400 && KWARGS_REFUSED.test(body)) {
            // The provider won't take the switch: remember, and ask again without it.
            this.thinkSwitch.set(model, false);
            return this.callModel(model, tier, messages, maxTokens, temperature, signal, purpose, false);
          }
          throw new UpstreamError("llm", res.status, `LLM returned ${res.status}${missing ? " (model not available)" : ""}: ${body.replace(/\s+/g, " ").slice(0, 160)}`);
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]; usage?: { total_tokens?: number } };
        const choice = data.choices?.[0];
        const content = choice?.message?.content ?? "";
        const finish = choice?.finish_reason ?? null;
        this.tokens += data.usage?.total_tokens ?? 0;
        const empty = !content.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
        this.record({ ...base, ms: Date.now() - t0, ok: !empty, status: res.status, finish, outChars: content.length, error: empty ? (finish === "length" ? "ran out of tokens before answering" : "empty answer") : null });
        if (empty) {
          this.strike(tier, model, finish === "length" ? "running out of tokens" : "empty answers");
          throw new CutOff(finish === "length" ? "length" : "empty");
        }
        this.strikes.delete(tier);
        if (thinkOff && this.thinkSwitch.get(model) === undefined) this.thinkSwitch.set(model, true);
        return { content, finish };
      },
      // One retry: a slow model shouldn't hold a whole mission hostage.
      { signal, retries: 1 }
    );
  }

  private async chat(messages: ChatMessage[], tier: ModelTier, maxTokens: number, temperature: number, signal: AbortSignal | undefined, purpose: string | null, forceThinkOff = false): Promise<Reply> {
    const model = this.modelFor(tier);
    const thinkOff = (forceThinkOff && this.thinkSwitch.get(model) !== false) || this.thinkSwitch.get(model) === true;
    try {
      return await this.callModel(model, tier, messages, maxTokens, temperature, signal, purpose, thinkOff);
    } catch (err) {
      // The provider doesn't serve this tier's model: use the main model from now on.
      if (tier !== "default" && model !== this.config.models.default && err instanceof UpstreamError && /model not available/.test(err.message)) {
        this.broken.add(tier);
        console.warn(`[engine] The ${tier} model "${model}" isn't available from your provider, so the main model is used instead. Check LLM_MODEL_${tier.toUpperCase()}.`);
        const main = this.config.models.default;
        return this.callModel(main, tier, messages, maxTokens, temperature, signal, purpose, this.thinkSwitch.get(main) === true);
      }
      throw err;
    }
  }

  /** Ask for JSON matching `schema`. Retries once with the validation error if the first answer is invalid. */
  async json<T>(req: JsonRequest<T>): Promise<T> {
    const tier = req.tier ?? "default";
    const budget = req.timeoutMs ? AbortSignal.timeout(req.timeoutMs) : null;
    const signal = budget ? (req.signal ? AbortSignal.any([req.signal, budget]) : budget) : req.signal;
    let maxTokens = req.maxTokens ?? 1200;
    const temperature = req.temperature ?? 0.4;
    const messages: ChatMessage[] = [
      // Nemotron models reason before answering unless told not to; for structured output that only adds latency.
      { role: "system", content: `${/nemotron/i.test(this.modelFor(tier)) ? "/no_think\n" : ""}${req.system}\n\nRespond with JSON only. No prose, no code fences.` },
      { role: "user", content: req.user },
    ];

    let lastError = "";
    let thinkOff = false;
    // Cut off mid-thought or mid-answer: give it more room once and, if it thinks by default, ask it not to.
    const roomier = () => {
      maxTokens = Math.min(4096, Math.round(maxTokens * 2));
      thinkOff = THINKS_BY_DEFAULT.test(this.modelFor(tier));
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      let reply: Reply;
      try {
        reply = await this.chat(messages, tier, maxTokens, temperature, signal, req.purpose ?? null, thinkOff);
      } catch (err) {
        if (err instanceof CutOff && attempt === 0 && !signal?.aborted) {
          lastError = err.message;
          roomier();
          continue;
        }
        throw err;
      }
      const text = reply.content;
      try {
        const parsed = req.schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        lastError = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
      } catch (err) {
        lastError = (err as Error).message;
      }
      // Half an answer is better asked again with more room than "repaired".
      if (reply.finish === "length" && attempt === 0 && !signal?.aborted) {
        roomier();
        continue;
      }
      messages.push({ role: "assistant", content: text.slice(0, 4000) });
      messages.push({ role: "user", content: `That JSON was invalid (${lastError}). Return corrected JSON only, matching the requested shape exactly.` });
    }
    throw new OutputError(`Model output failed validation: ${lastError}`);
  }
}
