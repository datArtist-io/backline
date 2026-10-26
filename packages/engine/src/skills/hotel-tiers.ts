// Hotels sorted into lanes people understand at a glance: best value (the cheapest of the good
// ones), lowest price, premium (the best and priciest) and closest. Every hotel gets a quality
// score and, only when one is really listed, a nightly price: a live bookable rate, the price shown
// on a booking site for the trip's dates (with the page), or a price quoted in research. Nothing is
// estimated: a hotel with no listed price says so. Pure.
import { z } from "zod";
import type { Place } from "./places";

export const TIER_IDS = ["value", "cheapest", "premium", "closest"] as const;
export type TierId = (typeof TIER_IDS)[number];

export const priceEstimateSchema = z.object({
  perNight: z.number(),
  total: z.number().nullable(),
  currency: z.string(),
  /** live: a bookable rate; listed: shown on a booking site for these dates; web: quoted in research. */
  basis: z.enum(["live", "listed", "web"]),
  /** The page the price is on. */
  url: z.string().nullable().optional(),
  site: z.string().nullable().optional(),
});
export type PriceEstimate = z.infer<typeof priceEstimateSchema>;

export const tierSchema = z.object({
  id: z.enum(TIER_IDS),
  label: z.string(),
  blurb: z.string(),
  picks: z.array(z.object({ id: z.string(), why: z.string(), quality: z.number(), price: priceEstimateSchema.nullable() })),
});
export type HotelTier = z.infer<typeof tierSchema>;

export const hotelScoreSchema = z.object({ id: z.string(), quality: z.number(), price: priceEstimateSchema.nullable() });
export type HotelScore = z.infer<typeof hotelScoreSchema>;


const SYMBOLS: [RegExp, string][] = [
  [/₦|\bngn\b|naira/i, "NGN"],
  [/\bgh₵|\bghs\b|cedi/i, "GHS"],
  [/\bksh|\bkes\b/i, "KES"],
  [/\bzar\b|\brand\b/i, "ZAR"],
  [/£|\bgbp\b/i, "GBP"],
  [/€|\beur\b/i, "EUR"],
  [/\bcad\b|c\$/i, "CAD"],
  [/\baed\b|dirham/i, "AED"],
  [/\$|\busd\b/i, "USD"],
];

/** A nightly price range from text like "₦45,000–60,000 per night" or "from $120". Null if there's no clear price. Pure. */
export function parsePrice(note: string | null | undefined, fallbackCurrency: string): { low: number; high: number; currency: string } | null {
  if (!note) return null;
  const currency = SYMBOLS.find(([re]) => re.test(note))?.[1] ?? fallbackCurrency;
  const nums = [...note.matchAll(/(\d[\d,.]*)\s*(k|m)?\b/gi)]
    .map((m) => {
      const n = Number(m[1].replace(/,/g, ""));
      const mult = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
      return n * mult;
    })
    .filter((n) => Number.isFinite(n) && n >= (currency === "NGN" || currency === "KES" ? 1_000 : 10));
  if (nums.length === 0) return null;
  // A total for several nights isn't a nightly rate; leave those to other evidence.
  if (/total|for \d+ nights|week/i.test(note) && !/night\b|per night|\/night|nightly/i.test(note)) return null;
  const low = Math.min(...nums.slice(0, 2));
  const high = Math.max(...nums.slice(0, 2));
  return { low, high, currency };
}

/** Quality out of 100 from rating, taste fit and how much is known about the place. Pure. */
export function hotelQuality(p: Pick<Place, "rating" | "fit" | "phone" | "website" | "affinity">): number {
  const rating = p.rating != null ? Math.max(0, Math.min(5, p.rating)) / 5 : 0.62;
  const fit = Math.max(0, Math.min(1, p.fit ?? 0));
  const known = (p.phone ? 0.5 : 0) + (p.website ? 0.5 : 0);
  return Math.round((rating * 0.7 + fit * 0.2 + known * 0.1) * 100);
}

/** Quality and nightly price for each hotel, in one currency. Pure. */
export function scoreHotels(stays: Place[], currency: string, nights: number): HotelScore[] {
  return stays.map((p) => {
    let price: PriceEstimate | null = null;
    const n = Math.max(1, nights);
    const pr = parsePrice(p.priceNote, currency);
    if (p.offer && p.offer.currency === currency) {
      const per = p.offer.perNight ?? p.offer.total / n;
      price = { perNight: Math.round(per), total: Math.round(p.offer.total), currency, basis: "live", url: null, site: p.offer.provider };
    } else if (p.rate && p.rate.currency === currency) {
      price = { perNight: p.rate.perNight, total: p.rate.total ?? p.rate.perNight * n, currency, basis: "listed", url: p.rate.url, site: p.rate.site };
    } else if (pr && pr.currency === currency) {
      const per = (pr.low + pr.high) / 2;
      price = { perNight: Math.round(per), total: Math.round(per * n), currency, basis: "web", url: p.sources[0]?.url ?? null, site: null };
    } else if (p.rate) {
      // Listed in another currency: show it as listed rather than convert at a guessed rate.
      price = { perNight: p.rate.perNight, total: p.rate.total ?? p.rate.perNight * n, currency: p.rate.currency, basis: "listed", url: p.rate.url, site: p.rate.site };
    }
    return { id: p.id, quality: hotelQuality(p), price };
  });
}

/** The four lanes, each with up to three hotels and a plain reason. Lanes with nothing to show are left out. Pure. */
export function tierHotels(stays: Place[], opts: { currency: string; nights: number; near?: string | null; take?: number }): { tiers: HotelTier[]; scores: HotelScore[] } {
  const take = opts.take ?? 3;
  const scores = scoreHotels(stays, opts.currency, opts.nights);
  const by = new Map(scores.map((s) => [s.id, s]));
  const place = new Map(stays.map((p) => [p.id, p]));
  // Only prices in the trip's currency can be compared.
  const priced = scores.filter((s) => s.price && s.price.currency === opts.currency);
  const perNight = (id: string) => (by.get(id)?.price?.currency === opts.currency ? by.get(id)!.price!.perNight : Number.POSITIVE_INFINITY);
  const qualities = scores.map((s) => s.quality).sort((a, b) => b - a);
  const good = qualities[Math.min(qualities.length - 1, Math.floor(qualities.length / 2))] ?? 0;
  const pick = (id: string, why: string) => ({ id, why, quality: by.get(id)!.quality, price: by.get(id)!.price });
  const ratingWord = (id: string) => (place.get(id)?.rating != null ? `rated ${place.get(id)!.rating!.toFixed(1)}` : "unrated so far");
  const distWord = (id: string) => (place.get(id)?.distanceKm != null ? `${place.get(id)!.distanceKm} km${opts.near ? ` from ${opts.near}` : ""}` : null);

  const tiers: HotelTier[] = [];
  // Best value: quality per unit of price, among the better half.
  // Lowest price is worked out first so best value can lead with a different hotel when there is one.
  const floor = Math.max(35, good - 25);
  const cheapest = priced
    .filter((s) => s.quality >= floor)
    .sort((a, b) => perNight(a.id) - perNight(b.id) || b.quality - a.quality)
    .slice(0, take);
  const valueAll = priced
    .filter((s) => s.quality >= good)
    .sort((a, b) => b.quality / Math.pow(perNight(b.id), 0.55) - a.quality / Math.pow(perNight(a.id), 0.55));
  const value = (valueAll.length > 1 && valueAll[0].id === cheapest[0]?.id ? [...valueAll.slice(1), valueAll[0]] : valueAll).slice(0, take);
  if (value.length) tiers.push({ id: "value", label: "Best value", blurb: "The most hotel for your money: well rated, sensibly priced.", picks: value.map((s) => pick(s.id, [ratingWord(s.id), distWord(s.id)].filter(Boolean).join(" · "))) });
  // Lowest price: cheapest that still clears a basic bar.
  if (cheapest.length) tiers.push({ id: "cheapest", label: "Lowest price", blurb: "The least you can pay for a decent, reachable place.", picks: cheapest.map((s) => pick(s.id, [ratingWord(s.id), distWord(s.id)].filter(Boolean).join(" · "))) });
  // Premium: the top-rated, highest-priced options.
  const top = [...scores].sort((a, b) => b.quality - a.quality).slice(0, Math.max(take, Math.ceil(scores.length / 3)));
  const premiumAll = top.sort((a, b) => {
    const pa = Number.isFinite(perNight(a.id)) ? perNight(a.id) : -1;
    const pb = Number.isFinite(perNight(b.id)) ? perNight(b.id) : -1;
    return pb - pa || b.quality - a.quality;
  });
  // Lead with a different hotel from best value when there's a choice, so each lane says something new.
  const premium = (premiumAll.length > 1 && premiumAll[0].id === value[0]?.id ? [premiumAll[1], premiumAll[0], ...premiumAll.slice(2)] : premiumAll).slice(0, take);
  if (premium.length) tiers.push({ id: "premium", label: "Premium", blurb: "The best-rated places, for when comfort matters more than cost.", picks: premium.map((s) => pick(s.id, [ratingWord(s.id), distWord(s.id)].filter(Boolean).join(" · "))) });
  // Closest: nearest to where they need to be.
  const closest = stays
    .filter((p) => p.distanceKm != null)
    .sort((a, b) => a.distanceKm! - b.distanceKm!)
    .slice(0, take);
  if (closest.length && opts.near) tiers.push({ id: "closest", label: "Closest", blurb: `Shortest trip to ${opts.near}.`, picks: closest.map((p) => pick(p.id, [distWord(p.id), ratingWord(p.id)].filter(Boolean).join(" · "))) });
  // Shown in this order: premium, closest, best value, lowest price.
  const ORDER: TierId[] = ["premium", "closest", "value", "cheapest"];
  tiers.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  return { tiers, scores };
}
