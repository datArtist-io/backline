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
    // Paid providers tried, and how many of them failed outright (rather than finding nothing).
    let tried = 0;
    let failed = 0;
    for (const [i, p] of this.providers.entries()) {
      const last = i === this.providers.length - 1;
      // The last provider (the free one) never rests: it's the fallback of the fallback.
      if (!last && (this.resting.get(p.provider) ?? 0) > Date.now()) {
        tried += 1;
        failed += 1;
        continue;
      }
      if (!last) tried += 1;
      try {
        const results = await p.search(query, opts);
        if (results.length) return results;
        if (!last || !failed) empty = true;
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        lastError = err;
        if (!last) failed += 1;
        if (!last && err instanceof UpstreamError && [401, 402, 403, 404, 429].includes(err.status ?? 0)) this.resting.set(p.provider, Date.now() + REST_MS);
      }
    }
    // Every paid provider failed and the free one had nothing: say research is down, not "nothing found".
    if (tried > 0 && failed === tried && !empty) throw lastError ?? new UpstreamError("web", null, "Every research provider is resting after errors");
    if (empty || !lastError) return [];
    throw lastError;
  }
}
