// Free research with no key: Wikivoyage (the travel guide: getting in, stations, airports, getting
// around, neighbourhoods, safety) and Wikipedia (places, venues, events). Uses the public MediaWiki
// API with a descriptive User-Agent, as Wikimedia asks. Text is third-party content: callers treat
// it as quoted data (SECURITY.md).
import { UpstreamError } from "../errors";
import { TtlCache } from "../util";
import type { ProviderCall, SearchOptions, WebResult, WebSearch } from "./web";

type Config = { userAgent?: string; timeoutMs?: number; lang?: string; fetch?: typeof fetch };

const STOP = new Set(
  "a an the of in on at to for from by with and or is are was were be been what which who whom whose when where why how do does did can could should would will i me my we our you your it its this that these those there here near nearest most likely typical typically usually about into than then them they their per vs".split(" ")
);

/** A search engine wants keywords, not a sentence. Pure. */
export function keywords(question: string): string {
  const words = question
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  return words.slice(0, 8).join(" ");
}

/** The paragraphs of a page that match the question best, up to `max` characters. Pure. */
export function bestPassage(text: string, question: string, max = 900): string {
  const want = keywords(question).toLowerCase().split(" ").filter((w) => w.length > 2);
  const paras = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40 && !/^=+.*=+$/.test(p));
  if (paras.length === 0) return text.slice(0, max);
  const score = (p: string) => {
    const l = p.toLowerCase();
    return want.reduce((n, w) => n + (l.includes(w) ? 1 : 0), 0);
  };
  const ranked = paras.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const out: string[] = [];
  let len = 0;
  for (const r of ranked) {
    if (r.s === 0 && out.length) break;
    if (len + r.p.length > max && out.length) break;
    out.push(r.p.slice(0, max));
    len += r.p.length;
  }
  return out.join(" ").slice(0, max);
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

export class WikiSearchClient implements WebSearch {
  readonly provider = "wikivoyage+wikipedia";
  private readonly cache = new TtlCache<WebResult[]>(6 * 60 * 60 * 1000, 300);
  private readonly records: ProviderCall[] = [];
  private readonly f: typeof fetch;

  constructor(private readonly config: Config = {}) {
    this.f = config.fetch ?? ((...a) => fetch(...a));
  }

  recentCalls(sinceMs = 0): ProviderCall[] {
    return this.records.filter((r) => r.at >= sinceMs);
  }

  // Wikimedia asks for gentle use: at most two requests at a time, spaced out, one retry on 429.
  private active = 0;
  private lastAt = 0;
  private readonly waiting: (() => void)[] = [];
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= 2) await new Promise<void>((r) => this.waiting.push(r));
    this.active += 1;
    try {
      const wait = this.lastAt + 150 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = Date.now();
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  private async api(site: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    try {
      return await this.slot(() => this.request(site, params, signal));
    } catch (err) {
      if (!(err instanceof UpstreamError && err.status === 429) || signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, 1200));
      return this.slot(() => this.request(site, params, signal));
    }
  }

  private async request(site: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = `https://${this.config.lang ?? "en"}.${site}.org/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 8000);
    const res = await this.f(url, { headers: { "User-Agent": this.config.userAgent || "Backline/1.0 (trip planning agent)", "Api-User-Agent": this.config.userAgent || "Backline/1.0 (trip planning agent)" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) throw new UpstreamError("web", res.status, `${site} returned ${res.status}`);
    return res.json();
  }

  /** Top matching pages on one site, each with its best passage for the question. */
  private async site(site: "wikivoyage" | "wikipedia", question: string, take: number, signal?: AbortSignal): Promise<WebResult[]> {
    const t0 = Date.now();
    try {
      const found = (await this.api(site, { action: "query", list: "search", srsearch: keywords(question) || question, srlimit: String(take), srprop: "snippet" }, signal)) as { query?: { search?: { title: string; snippet?: string }[] } };
      const hits = found.query?.search ?? [];
      const out = await Promise.all(
        hits.map(async (h, i) => {
          let content = stripTags(h.snippet ?? "");
          if (i === 0) {
            // The best page gets read properly; the rest keep their search snippet.
            const page = (await this.api(site, { action: "query", prop: "extracts", explaintext: "1", titles: h.title, exlimit: "1" }, signal).catch(() => null)) as { query?: { pages?: { extract?: string }[] } } | null;
            const text = page?.query?.pages?.[0]?.extract;
            if (text) content = bestPassage(text, question);
          }
          return { title: `${h.title} (${site === "wikivoyage" ? "Wikivoyage" : "Wikipedia"})`, url: `https://${this.config.lang ?? "en"}.${site}.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`, content, publishedDate: null } satisfies WebResult;
        })
      );
      this.records.push({ at: Date.now(), purpose: "research", model: site, ms: Date.now() - t0, ok: true, status: 200, error: null });
      return out.filter((r) => r.content.length > 20);
    } catch (err) {
      this.records.push({ at: Date.now(), purpose: "research", model: site, ms: Date.now() - t0, ok: false, status: err instanceof UpstreamError ? err.status : null, error: (err as Error).message.slice(0, 160) });
      throw err;
    } finally {
      if (this.records.length > 200) this.records.splice(0, this.records.length - 200);
    }
  }

  async search(query: string, opts: SearchOptions = {}): Promise<WebResult[]> {
    // Reference sites don't list hotel rates or booking emails.
    if (opts.need === "booking") return [];
    const max = opts.maxResults ?? 5;
    const key = JSON.stringify([query, max]);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const [voyage, pedia] = await Promise.allSettled([this.site("wikivoyage", query, 2, opts.signal), this.site("wikipedia", query, 3, opts.signal)]);
    if (voyage.status === "rejected" && pedia.status === "rejected") throw voyage.reason;
    const results = [...(voyage.status === "fulfilled" ? voyage.value : []), ...(pedia.status === "fulfilled" ? pedia.value : [])].slice(0, max);
    this.cache.set(key, results);
    return results;
  }
}
