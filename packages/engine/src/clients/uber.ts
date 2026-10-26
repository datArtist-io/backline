// Live ride prices from Uber's price estimates (the same calculation the Uber app uses).
// Needs a production app: sandbox returns made-up prices, so the context never builds this
// client for a sandbox app and the trip pages keep their honestly labelled estimates.
import { UpstreamError } from "../errors";

export type UberFare = { low: number; high: number; currency: string; product: string };

type Config = { clientId: string; clientSecret: string; scope?: string; baseUrl?: string; authUrl?: string; timeoutMs?: number; fetch?: typeof fetch };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

type RawPrice = { display_name?: string; low_estimate?: number | null; high_estimate?: number | null; currency_code?: string | null };

/** The cheapest ordinary product in an estimates response, as a fare range. Pure. */
export function cheapestFare(json: unknown): UberFare | null {
  const prices = (json as { prices?: RawPrice[] } | null)?.prices;
  if (!Array.isArray(prices)) return null;
  let best: UberFare | null = null;
  for (const p of prices) {
    const low = num(p.low_estimate);
    const high = num(p.high_estimate);
    const currency = str(p.currency_code);
    if (low == null || high == null || !currency || high < low) continue;
    if (!best || low < best.low) best = { low, high, currency, product: str(p.display_name) ?? "Uber" };
  }
  return best;
}

export class UberClient {
  readonly name = "Uber";
  private token: { value: string; expires: number } | null = null;
  private readonly base: string;
  private readonly auth: string;

  constructor(private readonly config: Config) {
    if (!config.clientId || !config.clientSecret) throw new Error("UberClient requires a client id and secret");
    this.base = (config.baseUrl || "https://api.uber.com").replace(/\/$/, "");
    this.auth = config.authUrl || "https://auth.uber.com/oauth/v2/token";
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const f = this.config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 10_000);
    const body = new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: "client_credentials" });
    if (this.config.scope) body.set("scope", this.config.scope);
    let res: Response;
    try {
      res = await f(this.auth, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (err) {
      throw new UpstreamError("rides", null, `Uber sign-in network error: ${(err as Error).message}`, "Uber didn't respond.");
    }
    const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !json?.access_token) throw new UpstreamError("rides", res.status, `Uber sign-in returned ${res.status}`, "Uber's key was rejected.");
    this.token = { value: json.access_token, expires: Date.now() + (num(json.expires_in) ?? 3600) * 1000 };
    return this.token.value;
  }

  /** The price range for one ride, or null when Uber has none for this trip. */
  async estimate(from: { lat: number; lon: number }, to: { lat: number; lon: number }, signal?: AbortSignal): Promise<UberFare | null> {
    const token = await this.accessToken(signal);
    const f = this.config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 10_000);
    const q = new URLSearchParams({ start_latitude: String(from.lat), start_longitude: String(from.lon), end_latitude: String(to.lat), end_longitude: String(to.lon) });
    let res: Response;
    try {
      res = await f(`${this.base}/v1.2/estimates/price?${q}`, { headers: { Authorization: `Bearer ${token}`, "Accept-Language": "en_US", Accept: "application/json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (err) {
      throw new UpstreamError("rides", null, `Uber network error: ${(err as Error).message}`, "Uber didn't respond.");
    }
    if (res.status === 401) this.token = null;
    if (!res.ok) throw new UpstreamError("rides", res.status, `Uber returned ${res.status}`, "Uber couldn't price this ride.");
    return cheapestFare(await res.json().catch(() => null));
  }
}
