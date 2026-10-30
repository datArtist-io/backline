// Several AI providers behind the one LlmClient interface, tried in order. When one is out of credit,
// refuses the key, is rate limited, times out or keeps giving unusable answers, the next one answers,
// and the broken one rests for a while so requests stop waiting on it. The last provider never rests.
import { UpstreamError } from "../errors";
import { LlmClient, type JsonRequest, type LlmCallRecord, type LlmConfig, type ModelTier } from "./llm";

/** Out of credit, bad key, forbidden, unknown endpoint: not coming back soon. */
const HARD = new Set([401, 402, 403, 404]);
const HARD_REST_MS = 30 * 60_000;
const SOFT_REST_MS = 3 * 60_000;

export class FailoverLlm extends LlmClient {
  private readonly clients: LlmClient[];
  private readonly restUntil = new Map<number, number>();
  /** The provider that answered last, for diagnostics. */
  lastUsed = 0;

  constructor(configs: LlmConfig[]) {
    if (configs.length === 0) throw new Error("FailoverLlm needs at least one provider");
    super(configs[0]);
    this.clients = configs.map((c) => new LlmClient(c));
  }

  /** Providers that aren't resting, best first; if all are, every one is worth a try. */
  private live(): number[] {
    const now = Date.now();
    const all = this.clients.map((_, i) => i);
    const ok = all.filter((i) => (this.restUntil.get(i) ?? 0) <= now);
    return ok.length ? ok : all;
  }

  override get tokenCount(): number {
    return this.clients.reduce((n, c) => n + c.tokenCount, 0);
  }

  override modelFor(tier: ModelTier = "default"): string {
    return this.clients[this.live()[0]].modelFor(tier);
  }

  override resting(): { tier: ModelTier; until: number }[] {
    return this.clients[this.live()[0]].resting();
  }

  override recentCalls(sinceMs = 0): LlmCallRecord[] {
    return this.clients.flatMap((c) => c.recentCalls(sinceMs)).sort((a, b) => a.at - b.at);
  }

  /** Providers currently resting (index and when they come back), for diagnostics. */
  restingProviders(): { provider: number; until: number }[] {
    const now = Date.now();
    return [...this.restUntil].filter(([, until]) => until > now).map(([provider, until]) => ({ provider, until }));
  }

  override async json<T>(req: JsonRequest<T>): Promise<T> {
    let lastError: unknown = null;
    const order = this.live();
    for (const [n, i] of order.entries()) {
      const last = n === order.length - 1;
      try {
        const out = await this.clients[i].json(req);
        this.lastUsed = i;
        return out;
      } catch (err) {
        if (req.signal?.aborted) throw err;
        lastError = err;
        const status = err instanceof UpstreamError ? err.status : null;
        // The last provider never rests: it is all there is.
        if (!last) this.restUntil.set(i, Date.now() + (status != null && HARD.has(status) ? HARD_REST_MS : SOFT_REST_MS));
        console.warn(`[llm] provider ${i + 1} failed${status ? ` (${status})` : ""}${last ? "" : ", trying the next"}`, err instanceof Error ? err.message.slice(0, 160) : "");
      }
    }
    throw lastError ?? new Error("No AI provider answered");
  }
}
