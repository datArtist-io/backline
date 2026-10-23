// Live hotel rates and instant booking through LiteAPI (Nuitee). The agent books and pays with the
// account's payment method (ACC_CREDIT_CARD): with a sandbox key the payment is simulated and no
// money moves; with a production key the account's card is charged. Card details never pass
// through Backline.
import type { Booking, GuestDetails, HeldRate, HotelOffer, HotelProvider, HotelSearch } from "./hotels";
import { UpstreamError } from "../errors";

type Config = { apiKey: string; baseUrl?: string; bookUrl?: string; timeoutMs?: number; fetch?: typeof fetch };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const nights = (a: string, b: string) => Math.max(1, Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000));

type RawRate = {
  name?: string;
  boardName?: string;
  retailRate?: { total?: { amount?: number; currency?: string }[] };
  cancellationPolicies?: { refundableTag?: string; cancelPolicyInfos?: { cancelTime?: string }[] };
};
type RawRoomType = { offerId?: string; rates?: RawRate[]; offerRetailRate?: { amount?: number; currency?: string } };
type RawHotelRates = { hotelId?: string; roomTypes?: RawRoomType[] };
type RawHotel = { id?: string; name?: string; latitude?: number; longitude?: number; address?: string; main_photo?: string; thumbnail?: string; stars?: number; rating?: number; starRating?: number };

/** Plain cancellation terms from LiteAPI's policy fields. Pure. */
export function cancellationText(p: RawRate["cancellationPolicies"]): { refundable: boolean | null; text: string | null } {
  if (!p) return { refundable: null, text: null };
  const refundable = p.refundableTag === "RFN" ? true : p.refundableTag === "NRFN" ? false : null;
  const until = p.cancelPolicyInfos?.map((c) => c.cancelTime).find((t): t is string => typeof t === "string");
  if (refundable === false) return { refundable, text: "Non-refundable" };
  if (refundable && until) return { refundable, text: `Free cancellation until ${until.slice(0, 10)}` };
  return { refundable, text: refundable ? "Refundable" : null };
}

/** The cheapest offer per hotel from a LiteAPI rates response, with hotel details joined in. Pure. */
export function offersFrom(json: unknown, q: Pick<HotelSearch, "checkin" | "checkout" | "currency">): HotelOffer[] {
  const body = (json ?? {}) as { data?: RawHotelRates[]; hotels?: RawHotel[] };
  const hotels = new Map((body.hotels ?? []).filter((h) => h.id).map((h) => [h.id!, h]));
  const n = nights(q.checkin, q.checkout);
  const out: HotelOffer[] = [];
  for (const h of body.data ?? []) {
    if (!h.hotelId) continue;
    let best: HotelOffer | null = null;
    for (const rt of h.roomTypes ?? []) {
      const rate = rt.rates?.[0];
      const total = num(rt.offerRetailRate?.amount) ?? num(rate?.retailRate?.total?.[0]?.amount);
      const currency = str(rt.offerRetailRate?.currency) ?? str(rate?.retailRate?.total?.[0]?.currency) ?? q.currency;
      if (!rt.offerId || total == null || total <= 0) continue;
      if (best && total >= best.total) continue;
      const info = hotels.get(h.hotelId);
      const c = cancellationText(rate?.cancellationPolicies);
      best = {
        hotelId: h.hotelId,
        name: str(info?.name) ?? h.hotelId,
        lat: num(info?.latitude),
        lon: num(info?.longitude),
        address: str(info?.address),
        stars: num(info?.stars ?? info?.starRating),
        rating: num(info?.rating),
        image: str(info?.main_photo) ?? str(info?.thumbnail),
        offerId: rt.offerId,
        roomName: str(rate?.name),
        board: str(rate?.boardName),
        refundable: c.refundable,
        cancellation: c.text,
        total: Math.round(total * 100) / 100,
        currency,
        perNight: Math.round((total / n) * 100) / 100,
      };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.total - b.total);
}

export class LiteApiProvider implements HotelProvider {
  readonly name = "LiteAPI";
  readonly sandbox: boolean;
  private readonly base: string;
  private readonly bookBase: string;

  constructor(private readonly config: Config) {
    if (!config.apiKey) throw new Error("LiteApiProvider requires an API key");
    this.sandbox = config.apiKey.startsWith("sand_");
    this.base = (config.baseUrl || "https://api.liteapi.travel/v3.0").replace(/\/$/, "");
    this.bookBase = (config.bookUrl || "https://book.liteapi.travel/v3.0").replace(/\/$/, "");
  }

  private async post(url: string, body: unknown, signal?: AbortSignal, timeoutMs = this.config.timeoutMs ?? 20000): Promise<unknown> {
    const f = this.config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { "X-API-Key": this.config.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      throw new UpstreamError("hotels", null, `LiteAPI network error: ${(err as Error).message}`, "The hotel booking service didn't respond.");
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = str((json as { error?: { message?: string } } | null)?.error?.message) ?? text.slice(0, 200);
      throw new UpstreamError("hotels", res.status, `LiteAPI returned ${res.status}: ${msg}`, res.status === 401 ? "The hotel booking key was rejected." : `The hotel couldn't be booked: ${msg}`);
    }
    return json;
  }

  async search(q: HotelSearch): Promise<HotelOffer[]> {
    const json = await this.post(
      `${this.base}/hotels/rates`,
      {
        latitude: q.lat,
        longitude: q.lon,
        radius: Math.round(q.radiusKm * 1000),
        checkin: q.checkin,
        checkout: q.checkout,
        currency: q.currency,
        guestNationality: q.guestNationality ?? "NG",
        occupancies: Array.from({ length: Math.max(1, q.rooms) }, () => ({ adults: Math.max(1, Math.ceil(q.adults / Math.max(1, q.rooms))) })),
        maxRatesPerHotel: 1,
        limit: q.limit ?? 30,
        timeout: 8,
      },
      q.signal
    );
    return offersFrom(json, q);
  }

  /** Lock the price of an offer before paying. */
  async hold(offerId: string, _guest: GuestDetails | null, signal?: AbortSignal): Promise<HeldRate> {
    const json = (await this.post(`${this.bookBase}/rates/prebook`, { offerId, usePaymentSdk: false }, signal)) as { data?: Record<string, unknown> };
    const d = json?.data ?? {};
    const holdId = str(d.prebookId);
    if (!holdId) throw new UpstreamError("hotels", null, "LiteAPI prebook returned no id", "That rate is no longer available.");
    const policies = (d.roomTypes as { rates?: RawRate[] }[] | undefined)?.[0]?.rates?.[0]?.cancellationPolicies;
    return { holdId, offerId, total: num(d.price) ?? 0, currency: str(d.currency) ?? "USD", cancellation: cancellationText(policies).text, checkoutUrl: null, checkout: null };
  }

  /** Pay for a held rate with the account's payment method and confirm the booking. */
  async pay(holdId: string, guest: GuestDetails, signal?: AbortSignal): Promise<Booking> {
    const person = { firstName: guest.firstName, lastName: guest.lastName, email: guest.email };
    const json = (await this.post(
      `${this.bookBase}/rates/book`,
      { prebookId: holdId, holder: person, payment: { method: "ACC_CREDIT_CARD" }, guests: [{ occupancyNumber: 1, ...person, ...(guest.phone ? { phone: guest.phone } : {}) }] },
      signal,
      40000
    )) as { data?: Record<string, unknown> };
    return bookingFrom(json?.data ?? {});
  }

  async confirm(holdId: string, guest: GuestDetails, payment: { transactionId: string }, signal?: AbortSignal): Promise<Booking> {
    const person = { firstName: guest.firstName, lastName: guest.lastName, email: guest.email };
    const json = (await this.post(`${this.bookBase}/rates/book`, { prebookId: holdId, holder: person, payment: { method: "TRANSACTION_ID", transactionId: payment.transactionId }, guests: [{ occupancyNumber: 1, ...person }] }, signal, 40000)) as {
      data?: Record<string, unknown>;
    };
    return bookingFrom(json?.data ?? {});
  }
}

/** A booking from LiteAPI's book response. Pure. */
export function bookingFrom(d: Record<string, unknown>): Booking {
  const status = String(d.status ?? "").toUpperCase();
  return {
    bookingId: str(d.bookingId) ?? "",
    status: status === "CONFIRMED" ? "confirmed" : status === "FAILED" || status === "CANCELLED" ? "failed" : "pending",
    hotelName: str((d.hotel as { name?: string } | undefined)?.name),
    checkin: str(d.checkin),
    checkout: str(d.checkout),
    total: num(d.price),
    currency: str(d.currency),
    reference: str(d.hotelConfirmationCode) ?? str(d.supplierBookingId) ?? str(d.bookingId),
  };
}
