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
  { match: /\bNG\b|nigeria|lagos(?![^]*portugal)|abuja|ibadan|port harcourt/i, provider: "Bolt", currency: "NGN", base: 527, perKm: 130, perMin: 23, min: 800, asOf: "2023" },
  // Typical ride-hail rates elsewhere (UberX-class), so every trip can budget its rides. Labelled as
  // typical rates, never as a quote; Uber's own live estimate replaces them where it's connected.
  { match: /united kingdom|\bUK\b|england|scotland|london|manchester|edinburgh/i, provider: "Uber", currency: "GBP", base: 2.5, perKm: 1.25, perMin: 0.2, min: 6, asOf: "typical" },
  { match: /japan|tokyo|osaka|kyoto/i, provider: "Uber", currency: "JPY", base: 500, perKm: 300, perMin: 60, min: 1200, asOf: "typical" },
  { match: /united arab emirates|\bUAE\b|dubai|abu dhabi/i, provider: "Uber", currency: "AED", base: 8, perKm: 2.2, perMin: 0.5, min: 15, asOf: "typical" },
  { match: /united states|\bUSA?\b|new york|los angeles|chicago|miami|san francisco|canada|toronto/i, provider: "Uber", currency: "USD", base: 2.5, perKm: 1.0, perMin: 0.35, min: 8, asOf: "typical" },
  { match: /france|paris|italy|rome|milan|spain|madrid|barcelona|portugal|lisbon|porto|germany|berlin|netherlands|amsterdam|belgium|austria|vienna|greece|athens|ireland|dublin/i, provider: "Uber", currency: "EUR", base: 2.5, perKm: 1.1, perMin: 0.3, min: 7, asOf: "typical" },
  { match: /kenya|nairobi/i, provider: "Uber", currency: "KES", base: 100, perKm: 40, perMin: 4, min: 250, asOf: "typical" },
  { match: /ghana|accra/i, provider: "Uber", currency: "GHS", base: 6, perKm: 2.5, perMin: 0.4, min: 15, asOf: "typical" },
  { match: /south africa|cape town|johannesburg/i, provider: "Uber", currency: "ZAR", base: 15, perKm: 8, perMin: 1, min: 40, asOf: "typical" },
  { match: /indonesia|bali|jakarta/i, provider: "Grab", currency: "IDR", base: 10000, perKm: 4500, perMin: 400, min: 15000, asOf: "typical" },
  { match: /./, provider: "Uber", currency: "USD", base: 2, perKm: 0.9, perMin: 0.25, min: 6, asOf: "typical" },
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
  const step2 = t.currency === "JPY" || t.currency === "IDR" || t.currency === "KES" ? (t.currency === "IDR" ? 1000 : 10) : step;
  return {
    provider: t.provider,
    low: roundTo(formula, step2),
    high: roundTo(formula * (t.asOf === "typical" ? 1.5 : 1.9), step2),
    currency: t.currency,
    basis: t.asOf === "typical" ? `Typical ${t.provider} rates for the city, with room for busy times (an estimate, not a quote)` : `${t.provider}'s published rates (${t.asOf}) with room for price rises and busy times`,
  };
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
