// Real airline fares from Google Flights (through SerpApi): the price Google shows for this exact
// route, date and number of travellers, with the airline, stops and journey time. Used when there's no
// live booking provider, so a fare on the slip is a real one, never a guess.
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type GoogleFare = {
  /** Total for all the travellers, one way, in `currency`. */
  total: number;
  currency: string;
  airline: string | null;
  stops: number;
  minutes: number | null;
  /** Google Flights' own page for this search. */
  url: string | null;
};

type Flight = { price?: unknown; total_duration?: unknown; flights?: { airline?: unknown }[]; layovers?: unknown[] };

/** The cheapest sensible fare from a Google Flights answer: among flights within 40% of the quickest journey. Pure. */
export function pickFare(json: unknown, currency: string): GoogleFare | null {
  const j = (json ?? {}) as { best_flights?: Flight[]; other_flights?: Flight[]; search_metadata?: { google_flights_url?: unknown } };
  const all = [...(j.best_flights ?? []), ...(j.other_flights ?? [])].filter((f) => num(f.price) != null && num(f.price)! > 0);
  if (!all.length) return null;
  const quickest = Math.min(...all.map((f) => num(f.total_duration) ?? Infinity));
  const sensible = all.filter((f) => !Number.isFinite(quickest) || (num(f.total_duration) ?? Infinity) <= quickest * 1.4);
  const f = (sensible.length ? sensible : all).sort((a, b) => num(a.price)! - num(b.price)!)[0];
  const airlines = [...new Set((f.flights ?? []).map((x) => (typeof x.airline === "string" ? x.airline : null)).filter((x): x is string => Boolean(x)))];
  return {
    total: num(f.price)!,
    currency,
    airline: airlines.join(" + ") || null,
    stops: Array.isArray(f.layovers) ? f.layovers.length : Math.max(0, (f.flights?.length ?? 1) - 1),
    minutes: num(f.total_duration),
    url: typeof j.search_metadata?.google_flights_url === "string" ? j.search_metadata.google_flights_url : null,
  };
}

export class GoogleFlightsClient {
  readonly name = "Google Flights";
  constructor(private readonly config: {
    apiKey: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
    /** Reuse an answer for the same route, dates and travellers this long (Next.js data cache), to save searches. */
    cacheSeconds?: number;
  }) {
    if (!config.apiKey) throw new Error("GoogleFlightsClient requires an API key");
  }

  /** The fare for one way, for `adults` travellers, by airport codes (IATA). Null when Google lists none. */
  async fare(q: { from: string; to: string; date: string; adults: number; currency: string; signal?: AbortSignal }): Promise<GoogleFare | null> {
    const p = new URLSearchParams({
      engine: "google_flights",
      departure_id: q.from,
      arrival_id: q.to,
      outbound_date: q.date,
      type: "2",
      adults: String(Math.max(1, Math.min(9, q.adults))),
      currency: q.currency,
      hl: "en",
      api_key: this.config.apiKey,
    });
    const f = this.config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 15000);
    const signal = q.signal ? AbortSignal.any([q.signal, timeout]) : timeout;
    // A practice run of the same trip shouldn't spend another search (the free plan has 250 a month).
    const cache = this.config.cacheSeconds ? { next: { revalidate: this.config.cacheSeconds } } : {};
    const res = await f(`https://serpapi.com/search.json?${p}`, { signal, ...cache } as RequestInit);
    if (!res.ok) throw new Error(`Google Flights returned ${res.status}`);
    return pickFare(await res.json(), q.currency);
  }
}
