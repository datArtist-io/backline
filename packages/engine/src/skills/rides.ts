// Getting between stops: walk when it's short, otherwise a ride with an honest fare range and
// buttons that open the ride apps. Fares come from each city's last published Bolt rates; apps
// change prices (and surge), so the range runs above the published formula and is always labelled
// an estimate. Where no rates are known, only distance and time are shown. Pure.
import { z } from "zod";

export const rideSchema = z.object({
  provider: z.string(),
  low: z.number(),
  high: z.number(),
  currency: z.string(),
  /** Where the numbers come from, for the page's small print. */
  basis: z.string(),
});
export type RideEstimate = z.infer<typeof rideSchema>;

type FareTable = { match: RegExp; provider: string; currency: string; base: number; perKm: number; perMin: number; min: number; asOf: string };

/** Published ride rates by country or city. Extend as rates are confirmed. */
const FARES: FareTable[] = [
  // Bolt Lagos, published June 2023 (Techloy). Prices have risen since: the high end allows for it.
  { match: /\bNG\b|nigeria|lagos|abuja|ibadan|port harcourt/i, provider: "Bolt", currency: "NGN", base: 527, perKm: 130, perMin: 23, min: 800, asOf: "2023" },
];

/** Walking is the better choice below this distance. */
export const WALK_KM = 1.2;

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

/** A fare range for one ride, or null where no rates are known. Pure. */
export function rideFare(km: number, minutes: number, where: string): RideEstimate | null {
  const t = FARES.find((f) => f.match.test(where));
  if (!t || km <= 0) return null;
  const formula = Math.max(t.min, t.base + t.perKm * km + t.perMin * minutes);
  const step = t.currency === "NGN" ? 100 : 1;
  // Low: the published formula. High: price rises since then and busy-time pricing.
  return { provider: t.provider, low: roundTo(formula, step), high: roundTo(formula * 1.9, step), currency: t.currency, basis: `${t.provider}'s published rates (${t.asOf}) with room for price rises and busy times` };
}

/** Countries where Uber still operates ride-hailing (it left Nigeria in September 2026). */
const NO_UBER = /\bNG\b|nigeria/i;

/** Whether Uber runs ride-hailing where this trip is. Pure. */
export const uberServes = (where: string) => !NO_UBER.test(where);

/** Buttons for a ride from one point to another. Uber links open with both ends filled in. Pure. */
export function rideLinks(from: { lat: number; lon: number }, to: { lat: number; lon: number; name: string }, where: string): { label: string; url: string }[] {
  const links = [{ label: "Open Bolt", url: "https://bolt.eu/" }];
  if (uberServes(where)) {
    const q = new URLSearchParams({
      action: "setPickup",
      "pickup[latitude]": from.lat.toFixed(6),
      "pickup[longitude]": from.lon.toFixed(6),
      "dropoff[latitude]": to.lat.toFixed(6),
      "dropoff[longitude]": to.lon.toFixed(6),
      "dropoff[nickname]": to.name.slice(0, 60),
    });
    links.push({ label: "Uber", url: `https://m.uber.com/ul/?${q}` });
  }
  return links;
}
