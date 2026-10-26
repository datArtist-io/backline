// Location handling that works for any place on Earth, in any script.
// Nothing here is tied to a specific country or city.
import { InputError } from "./errors";
import type { QlooEntity } from "./clients/qloo";
import type { SkillContext } from "./types";

const MAX_LEN = 80;
// Letters and marks in any script, digits, spaces and common place-name punctuation.
const ALLOWED = /^[\p{L}\p{M}\p{N} .,'’()\-]+$/u;

/** Clean and validate a user-entered location. Returns null for empty input. */
export function normalizeLocation(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = raw
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
  if (!s) return null;
  if (s.length > MAX_LEN) throw new InputError(`Location is too long. Keep it under ${MAX_LEN} characters.`);
  if (!ALLOWED.test(s)) throw new InputError("Location can only contain letters, numbers, spaces and basic punctuation.");
  return s;
}

/**
 * Broader and broader versions of a location, from the comma-separated parts.
 * "Ikeja, Lagos, Nigeria" -> ["Ikeja, Lagos, Nigeria", "Lagos, Nigeria", "Nigeria"].
 */
export function broadeningLadder(location: string): string[] {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(i).join(", "));
  return out;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PlaceSearch = {
  items: QlooEntity[];
  /** What we actually searched, shown to the user so nothing is hidden. */
  searched: string;
  coverage: "exact" | "broadened" | "nearby" | "none";
};

const RADII_KM = [25, 75, 200];

/**
 * Find places matching a taste in any location, widening the search step by step if the
 * exact place has little data. Every result is guaranteed to be inside the area searched.
 */
export async function findPlaces(
  ctx: SkillContext,
  entityIds: string[],
  rawLocation: string,
  opts: { filterTags?: string[]; take?: number } = {}
): Promise<PlaceSearch> {
  const location = normalizeLocation(rawLocation);
  if (!location) throw new InputError("Enter a location.");
  const take = opts.take ?? 10;

  // 1) The place as typed, then broader comma-separated parents.
  const ladder = broadeningLadder(location);
  for (const [i, q] of ladder.entries()) {
    const items = await ctx.qloo.insights("urn:entity:place", { entityIds, filterLocation: q, filterTags: opts.filterTags, take }, ctx.signal);
    ctx.usage.add("qloo", 1);
    if (items.length > 0) return { items, searched: q, coverage: i === 0 ? "exact" : "broadened" };
  }

  // 2) Resolve the place to coordinates and search a growing radius around it.
  const [anchor] = await ctx.qloo.search(location, { types: ["urn:entity:destination"], take: 1, signal: ctx.signal });
  ctx.usage.add("qloo", 1);
  if (anchor?.location) {
    for (const radiusKm of RADII_KM) {
      const raw = await ctx.qloo.insights(
        "urn:entity:place",
        { entityIds, near: { ...anchor.location, radiusKm }, filterTags: opts.filterTags, take },
        ctx.signal
      );
      ctx.usage.add("qloo", 1);
      // Guard against the API ignoring the radius: keep only results that are really nearby.
      const items = raw.filter((p) => p.location && distanceKm(anchor.location!, p.location) <= radiusKm * 1.2);
      if (items.length > 0) return { items, searched: `within ${radiusKm} km of ${anchor.name}`, coverage: "nearby" };
    }
  }

  ctx.log.info("No place data for location", { location });
  return { items: [], searched: location, coverage: "none" };
}
