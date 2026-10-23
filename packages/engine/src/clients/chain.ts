// Several research providers behind one interface, tried in order: the best one that's working
// answers. A provider that's out of quota or refuses the key rests for a while, and one that finds
// nothing hands over to the next, so research keeps working on a free setup.
import { UpstreamError } from "../errors";
import type { ProviderCall, SearchOptions, WebResult, WebSearch } from "./web";

const REST_MS = 10 * 60_000;

export class ChainedWebSearch implements WebSearch {
  private readonly resting = new Map<string, number>();

  constructor(private readonly providers: WebSearch[]) {
    if (providers.length === 0) throw new Error("ChainedWebSearch needs at least one provider");
  }

  get provider(): string {
    return this.providers.map((p) => p.provider).join(" → ");
  }

  recentCalls(sinceMs = 0): ProviderCall[] {
    return this.providers.flatMap((p) => p.recentCalls?.(sinceMs) ?? []).sort((a, b) => a.at - b.at);
  }

  async search(query: string, opts: SearchOptions = {}): Promise<WebResult[]> {
    let lastError: unknown = null;
    let empty = false;
    for (const [i, p] of this.providers.entries()) {
      const last = i === this.providers.length - 1;
      // The last provider (the free one) never rests: it's the fallback of the fallback.
      if (!last && (this.resting.get(p.provider) ?? 0) > Date.now()) continue;
      try {
        const results = await p.search(query, opts);
        if (results.length) return results;
        empty = true;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        lastError = err;
        if (!last && err instanceof UpstreamError && [401, 403, 404, 429].includes(err.status ?? 0)) this.resting.set(p.provider, Date.now() + REST_MS);
      }
    }
    if (empty || !lastError) return [];
    throw lastError;
  }
}
