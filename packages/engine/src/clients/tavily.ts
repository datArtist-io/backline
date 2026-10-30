// Tavily web search client. Results are untrusted third-party content: callers must treat
// them as quoted data, never as instructions (see SECURITY.md, prompt injection).
import { UpstreamError } from "../errors";
import { TtlCache, withRetry } from "../util";

import type { WebResult, WebSearch } from "./web";
export type { WebResult } from "./web";

type Config = { apiKey: string; baseUrl?: string; timeoutMs?: number };

export class TavilyClient implements WebSearch {
  readonly provider = "tavily";
  private readonly base: string;
  private readonly cache = new TtlCache<WebResult[]>(60 * 60 * 1000, 300);

  constructor(private readonly config: Config) {
    if (!config.apiKey) throw new Error("TavilyClient requires an API key");
    this.base = (config.baseUrl || "https://api.tavily.com").replace(/\/$/, "");
  }

  async search(query: string, opts: { maxResults?: number; days?: number; signal?: AbortSignal; pageChars?: number } = {}): Promise<WebResult[]> {
    const key = JSON.stringify([query, opts.maxResults, opts.days, opts.pageChars ?? 0]);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const results = await withRetry(
      async () => {
        let res: Response;
        try {
          const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 20000);
          res = await fetch(`${this.base}/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
            body: JSON.stringify({
              query,
              max_results: opts.maxResults ?? 5,
              search_depth: "basic",
              topic: opts.days ? "news" : "general",
              ...(opts.days ? { days: opts.days } : {}),
              include_answer: false,
              include_raw_content: opts.pageChars ? "text" : false,
            }),
            signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
          });
        } catch (err) {
          throw new UpstreamError("web", null, `Tavily network error: ${(err as Error).message}`);
        }
        if (!res.ok) throw new UpstreamError("web", res.status, `Tavily returned ${res.status}`);
        const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string; raw_content?: string | null; published_date?: string }[] };
        return (data.results || [])
          .filter((r) => typeof r.url === "string" && r.url.startsWith("https://"))
          .map((r) => ({
            title: (r.title || "").slice(0, 200),
            url: r.url as string,
            content: opts.pageChars && r.raw_content ? r.raw_content.replace(/\s+/g, " ").slice(0, opts.pageChars) : (r.content || "").slice(0, 1500),
            publishedDate: r.published_date ?? null,
          }));
      },
      { signal: opts.signal }
    );
    this.cache.set(key, results);
    return results;
  }
}
