// Flights through Duffel: find airports, search fares and book with payment from the account's
// balance. With a test token (duffel_test_…) bookings are made on Duffel's test airline and no
// money moves; with a live token the account balance pays for real tickets.
import { UpstreamError } from "../errors";

export type FlightLeg = { from: string; fromName: string | null; to: string; toName: string | null; departs: string; arrives: string; carrier: string | null; flight: string | null; stops: number; minutes: number | null };

export type FlightOffer = {
  offerId: string;
  /** Duffel's passenger ids for this offer, needed to book it. */
  passengerIds: string[];
  airline: string | null;
  total: number;
  currency: string;
  outbound: FlightLeg;
  /** The return flight, for a round trip. */
  inbound: FlightLeg | null;
  refundable: boolean | null;
};

export type Traveller = { givenName: string; familyName: string; email: string; phone: string; bornOn: string; gender: "m" | "f" };

export type FlightBooking = { orderId: string; reference: string | null; total: number | null; currency: string | null };

type Config = { token: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Minutes in an ISO 8601 duration like "PT2H35M" or "P1DT1H". Pure. */
export function durationMinutes(iso: unknown): number | null {
  const m = typeof iso === "string" ? iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/) : null;
  if (!m) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

type RawSegment = { departing_at?: string; arriving_at?: string; marketing_carrier?: { name?: string; iata_code?: string }; marketing_carrier_flight_number?: string; origin?: { iata_code?: string; name?: string }; destination?: { iata_code?: string; name?: string } };
type RawSlice = { origin?: { iata_code?: string; name?: string; city_name?: string }; destination?: { iata_code?: string; name?: string; city_name?: string }; duration?: string; segments?: RawSegment[] };
type RawOffer = { id?: string; total_amount?: string; total_currency?: string; owner?: { name?: string }; slices?: RawSlice[]; passengers?: { id?: string }[]; conditions?: { refund_before_departure?: { allowed?: boolean } | null } };

function legFrom(s: RawSlice | undefined): FlightLeg | null {
  const segs = s?.segments ?? [];
  if (!s || segs.length === 0) return null;
  const first = segs[0];
  const last = segs[segs.length - 1];
  return {
    from: str(s.origin?.iata_code) ?? str(first.origin?.iata_code) ?? "",
    fromName: str(s.origin?.name),
    to: str(s.destination?.iata_code) ?? str(last.destination?.iata_code) ?? "",
    toName: str(s.destination?.name),
    departs: str(first.departing_at) ?? "",
    arrives: str(last.arriving_at) ?? "",
    carrier: str(first.marketing_carrier?.name),
    flight: first.marketing_carrier?.iata_code && first.marketing_carrier_flight_number ? `${first.marketing_carrier.iata_code}${first.marketing_carrier_flight_number}` : null,
    stops: segs.length - 1,
    minutes: durationMinutes(s.duration),
  };
}

/** Offers from a Duffel offer request response, cheapest first. Pure. */
export function flightOffersFrom(json: unknown): FlightOffer[] {
  const d = ((json ?? {}) as { data?: { offers?: RawOffer[]; passengers?: { id?: string }[] } }).data ?? {};
  const requestPassengers = (d.passengers ?? []).map((p) => p.id).filter((x): x is string => Boolean(x));
  const out: FlightOffer[] = [];
  for (const o of d.offers ?? []) {
    const total = num(o.total_amount);
    const outbound = legFrom(o.slices?.[0]);
    if (!o.id || total == null || !outbound) continue;
    const ids = (o.passengers ?? []).map((p) => p.id).filter((x): x is string => Boolean(x));
    out.push({
      offerId: o.id,
      passengerIds: ids.length ? ids : requestPassengers,
      airline: str(o.owner?.name),
      total,
      currency: str(o.total_currency) ?? "USD",
      outbound,
      inbound: legFrom(o.slices?.[1]),
      refundable: o.conditions?.refund_before_departure ? Boolean(o.conditions.refund_before_departure.allowed) : null,
    });
  }
  return out.sort((a, b) => a.total - b.total);
}

/**
 * The offer to book: among fares within 40% of the shortest journey, the cheapest, preferring
 * direct flights when they cost at most 15% more. Pure.
 */
export function bestFlight(offers: FlightOffer[]): FlightOffer | null {
  if (offers.length === 0) return null;
  const mins = (o: FlightOffer) => (o.outbound.minutes ?? 0) + (o.inbound?.minutes ?? 0);
  const shortest = Math.min(...offers.map(mins));
  const sensible = offers.filter((o) => !shortest || mins(o) <= shortest * 1.4).sort((a, b) => a.total - b.total);
  const cheapest = sensible[0] ?? offers[0];
  const direct = sensible.find((o) => o.outbound.stops === 0 && (o.inbound?.stops ?? 0) === 0);
  return direct && direct.total <= cheapest.total * 1.15 ? direct : cheapest;
}

export class DuffelClient {
  readonly name = "Duffel";
  readonly sandbox: boolean;
  private readonly base: string;

  constructor(private readonly config: Config) {
    if (!config.token) throw new Error("DuffelClient requires a token");
    this.sandbox = config.token.startsWith("duffel_test_");
    this.base = (config.baseUrl || "https://api.duffel.com").replace(/\/$/, "");
  }

  private async call(method: "GET" | "POST", path: string, body: unknown, signal?: AbortSignal, timeoutMs = this.config.timeoutMs ?? 25000): Promise<unknown> {
    const f = this.config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await f(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.config.token}`, "Duffel-Version": "v2", "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify({ data: body }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      throw new UpstreamError("flights", null, `Duffel network error: ${(err as Error).message}`, "The flight booking service didn't respond.");
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = str((json as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message) ?? text.slice(0, 200);
      throw new UpstreamError("flights", res.status, `Duffel returned ${res.status}: ${msg}`, res.status === 401 ? "The flight booking key was rejected." : `The flight couldn't be booked: ${msg}`);
    }
    return json;
  }

  /** The IATA code of the main airport (or city) for a place name. */
  async airport(query: string, signal?: AbortSignal): Promise<{ code: string; name: string } | null> {
    const json = (await this.call("GET", `/places/suggestions?query=${encodeURIComponent(query)}`, undefined, signal, 10000)) as { data?: { type?: string; iata_code?: string; name?: string }[] };
    const places = (json?.data ?? []).filter((p) => p.iata_code);
    const pick = places.find((p) => p.type === "city") ?? places.find((p) => p.type === "airport");
    return pick ? { code: pick.iata_code!, name: pick.name ?? pick.iata_code! } : null;
  }

  /** Fares for a one-way or round trip, cheapest first. */
  async search(q: { from: string; to: string; depart: string; back?: string | null; adults: number; signal?: AbortSignal }): Promise<FlightOffer[]> {
    const slices = [{ origin: q.from, destination: q.to, departure_date: q.depart }, ...(q.back ? [{ origin: q.to, destination: q.from, departure_date: q.back }] : [])];
    const json = await this.call("POST", "/air/offer_requests?return_offers=true&supplier_timeout=15000", { slices, passengers: Array.from({ length: Math.max(1, q.adults) }, () => ({ type: "adult" })), cabin_class: "economy" }, q.signal, 30000);
    return flightOffersFrom(json).slice(0, 30);
  }

  /** Book an offer and pay from the account balance. */
  async book(offer: Pick<FlightOffer, "offerId" | "passengerIds" | "total" | "currency">, travellers: Traveller[], signal?: AbortSignal): Promise<FlightBooking> {
    const passengers = offer.passengerIds.map((id, i) => {
      const t = travellers[i] ?? travellers[0];
      return { id, given_name: t.givenName, family_name: t.familyName, born_on: t.bornOn, gender: t.gender, title: t.gender === "f" ? "ms" : "mr", email: t.email, phone_number: t.phone };
    });
    const json = (await this.call(
      "POST",
      "/air/orders",
      { type: "instant", selected_offers: [offer.offerId], payments: [{ type: "balance", currency: offer.currency, amount: offer.total.toFixed(2) }], passengers },
      signal,
      45000
    )) as { data?: { id?: string; booking_reference?: string; total_amount?: string; total_currency?: string } };
    const d = json?.data ?? {};
    if (!d.id) throw new UpstreamError("flights", null, "Duffel returned no order", "The flight couldn't be booked.");
    return { orderId: d.id, reference: str(d.booking_reference), total: num(d.total_amount), currency: str(d.total_currency) };
  }
}
