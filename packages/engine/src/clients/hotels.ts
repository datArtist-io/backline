// Live hotel availability and reservations through a booking provider. The provider handles
// payment: the agent never sees or stores card details.

/** One bookable room rate at one hotel, for specific dates and guests. */
export type HotelOffer = {
  /** The provider's id for the hotel. */
  hotelId: string;
  name: string;
  lat: number | null;
  lon: number | null;
  address: string | null;
  stars: number | null;
  rating: number | null;
  image: string | null;
  /** The provider's id for this exact rate; used to hold it. */
  offerId: string;
  roomName: string | null;
  /** "Room only", "Breakfast included"… */
  board: string | null;
  refundable: boolean | null;
  /** Plain-language cancellation terms, e.g. "Free cancellation until 26 Oct". */
  cancellation: string | null;
  /** Total for the whole stay, taxes included where the provider says so. */
  total: number;
  currency: string;
  perNight: number | null;
};

export type HotelSearch = {
  lat: number;
  lon: number;
  radiusKm: number;
  checkin: string;
  checkout: string;
  adults: number;
  rooms: number;
  currency: string;
  /** ISO country code of the guest, which some rates depend on. */
  guestNationality?: string;
  limit?: number;
  signal?: AbortSignal;
};

/** A rate held for a short time while the guest pays on the provider's page. */
export type HeldRate = {
  holdId: string;
  offerId: string;
  total: number;
  currency: string;
  cancellation: string | null;
  /** Where the guest pays to confirm. Never handled by the agent. */
  checkoutUrl: string | null;
  /** Provider details the checkout page needs (not secrets of ours). */
  checkout: Record<string, string> | null;
};

export type GuestDetails = { firstName: string; lastName: string; email: string; phone?: string };

export type Booking = { bookingId: string; status: "confirmed" | "pending" | "failed"; hotelName: string | null; checkin: string | null; checkout: string | null; total: number | null; currency: string | null; reference: string | null };

export interface HotelProvider {
  readonly name: string;
  /** Test mode: nothing is really booked or charged. */
  readonly sandbox: boolean;
  /** Live rates for hotels around a point. Cheapest rate per hotel, nearest and best value first. */
  search(q: HotelSearch): Promise<HotelOffer[]>;
  /** Hold a rate and get the secure checkout details for it. */
  hold(offerId: string, guest: GuestDetails | null, signal?: AbortSignal): Promise<HeldRate>;
  /** Pay for a held rate with the account's own payment method and confirm it, when the provider supports it. */
  pay?(holdId: string, guest: GuestDetails, signal?: AbortSignal): Promise<Booking>;
  /** Confirm a held rate once the guest has paid on the provider's page. */
  confirm(holdId: string, guest: GuestDetails, payment: { transactionId: string }, signal?: AbortSignal): Promise<Booking>;
}
