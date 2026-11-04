// Live prices, demo checkout. With live provider keys the search is real (airline fares, hotel rates),
// but nothing is bought unless BOOKING_LIVE=1: "booking" returns a DEMO- reference at the live price,
// paid from the demo wallet. Holding a hotel rate (LiteAPI prebook) only locks the price, so it stays real.
import { DuffelClient, type FlightBooking, type FlightOffer } from "./duffel";
import { LiteApiProvider } from "./liteapi";
import type { Booking, GuestDetails } from "./hotels";
import type { Traveller } from "./duffel";

/** A reference for a demo booking: recognisable, never a real airline or hotel code. */
export const demoRef = () => `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
export const isDemoRef = (ref: string | null | undefined) => Boolean(ref && ref.startsWith("DEMO-"));

export class PriceOnlyDuffel extends DuffelClient {
  readonly priceOnly = true;
  override async book(offer: Pick<FlightOffer, "offerId" | "passengerIds" | "total" | "currency">, _travellers: Traveller[]): Promise<FlightBooking> {
    const ref = demoRef();
    return { orderId: ref, reference: ref, total: offer.total, currency: offer.currency };
  }
}

export class PriceOnlyLiteApi extends LiteApiProvider {
  readonly priceOnly = true;
  private readonly held = new Map<string, { total: number; currency: string }>();
  override async hold(offerId: string, guest: GuestDetails | null, signal?: AbortSignal) {
    const h = await super.hold(offerId, guest, signal);
    this.held.set(h.holdId, { total: h.total, currency: h.currency });
    return h;
  }
  private demo(holdId: string): Booking {
    const h = this.held.get(holdId);
    const ref = demoRef();
    return { bookingId: ref, status: "confirmed", hotelName: null, checkin: null, checkout: null, total: h?.total ?? null, currency: h?.currency ?? null, reference: ref };
  }
  override async pay(holdId: string): Promise<Booking> {
    return this.demo(holdId);
  }
  override async confirm(holdId: string): Promise<Booking> {
    return this.demo(holdId);
  }
}
