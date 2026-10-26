// Maps without an API key: OpenStreetMap geocoding (Nominatim, then Photon as a fallback) and
// places around a point (Overpass). These are free community services with fair-use rules, so
// the client identifies itself, keeps geocoding to one request a second, caches everything and
// moves to the next service on errors instead of hammering.
// Map data © OpenStreetMap contributors (ODbL): credit it wherever results are shown.
import { UpstreamError } from "../errors";
import { distanceKm } from "../location";
import { TtlCache, foldText, sleep } from "../util";

export type GeoHit = {
  name: string;
  /** Full human-readable address, e.g. "Lagos, Lagos State, Nigeria". */
  display: string;
  lat: number;
  lon: number;
  country: string | null;
  /** ISO 3166-1 alpha-2, upper case ("NG"). */
  countryCode: string | null;
  /** What it is: "city", "theatre", "hotel"… */
  kind: string | null;
  /** 0–1, how prominent the place is. Used to break ties between same-named places. */
  importance: number;
  source: "nominatim" | "photon";
};

export type OsmKind = "stay" | "dine" | "venue" | "activity";

export type OsmPlace = {
  /** "osm:n123" (node), "osm:w45" (way), "osm:r6" (relation). */
  id: string;
  url: string;
  name: string;
  lat: number;
  lon: number;
  /** The OSM category, e.g. "hotel", "restaurant", "events_venue". */
  category: string;
  /** Human-readable labels: ["Hotel", "4-star", "Nigerian cuisine"]. */
  tags: string[];
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  stars: number | null;
  hours: string | null;
};

export type RouteMode = "car" | "foot";

export type Route = {
  km: number;
  minutes: number;
  /** One leg per pair of consecutive points. */
  legs: { km: number; minutes: number }[];
  /** The road geometry as [lat, lon] pairs, simplified for drawing. */
  path: [number, number][];
};

export type OsmConfig = {
  /** Identifies the app to the map services, as their usage policies require. */
  userAgent?: string;
  /** Optional contact address sent with geocoding requests. */
  email?: string;
  nominatimUrl?: string;
  photonUrl?: string;
  overpassUrls?: string[];
  /** OSRM servers per mode, tried in order. */
  routingUrls?: Partial<Record<RouteMode, string[]>>;
  timeoutMs?: number;
  /** Gap between geocoding requests. Nominatim allows at most one a second. */
  minIntervalMs?: number;
  fetch?: typeof fetch;
};

const DEFAULT_UA = "Backline/0.2 (trip-planning agent)";

/** Nominatim special phrases per kind, used when Overpass is unavailable. */
const NOMINATIM_PHRASES: Record<OsmKind, string[]> = {
  stay: ["[hotel]", "[guest house]"],
  dine: ["[restaurant]", "[cafe]"],
  venue: ["[events venue]", "[conference centre]"],
  activity: ["[attraction]", "[museum]"],
};

const OVERPASS_FILTERS: Record<OsmKind, string[]> = {
  stay: ['["tourism"~"^(hotel|guest_house|apartment|hostel|motel|resort)$"]'],
  dine: ['["amenity"~"^(restaurant|cafe|bar|pub|food_court|fast_food)$"]'],
  venue: ['["amenity"~"^(events_venue|conference_centre|community_centre|theatre|arts_centre|nightclub|exhibition_centre)$"]'],
  activity: ['["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|theme_park|aquarium)$"]', '["leisure"~"^(park|water_park|nature_reserve|beach_resort)$"]'],
};

/** Common spelling differences in place names, so "national theater" still finds "National Theatre". */
const SPELLINGS: [RegExp, string][] = [
  [/\btheater\b/i, "theatre"],
  [/\btheatre\b/i, "theater"],
  [/\bcenter\b/i, "centre"],
  [/\bcentre\b/i, "center"],
];

/** The query plus up to two spelling variants. Pure. */
export function spellingVariants(query: string): string[] {
  const q = query.replace(/^\s*the\s+/i, "").replace(/\s+/g, " ").trim();
  const out = [q];
  for (const [re, rep] of SPELLINGS) {
    if (re.test(q)) out.push(q.replace(new RegExp(re.source, "gi"), (m) => (m[0] === m[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep)));
  }
  return [...new Set(out)].slice(0, 3);
}

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const first = (v: string | undefined) => (v ? v.split(";")[0].trim() || null : null);
const EMAIL = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;

function httpsUrl(v: string | undefined): string | null {
  const s = first(v);
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^www\./i.test(s) ? `https://${s}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme.replace(/^http:/i, "https:"));
    return u.protocol === "https:" ? u.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

type NominatimItem = {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  importance?: number;
  extratags?: Record<string, string> | null;
  address?: { country?: string; country_code?: string; road?: string; house_number?: string; suburb?: string; neighbourhood?: string; city?: string; town?: string; state?: string };
};

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; country?: string; countrycode?: string; city?: string; state?: string; street?: string; osm_value?: string; type?: string };
};

type OverpassElement = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };

/** Nominatim's answer → hits. Pure. */
const SETTLEMENT = /^(city|town|village|hamlet|municipality|borough|suburb|quarter|neighbourhood|city_district|district|county|state|province|region|country|island|administrative)$/;

/**
 * What a geocoder hit is. Settlements keep their address type ("city", "town"); anything else uses
 * its own type ("train_station", "hotel", "theatre"), since its address type is often just "building"
 * or "amenity". Pure.
 */
export function hitKind(addresstype?: string | null, type?: string | null, category?: string | null): string | null {
  if (addresstype && SETTLEMENT.test(addresstype)) return addresstype;
  if (type && type !== "yes") return type;
  return category || addresstype || null;
}

export function fromNominatim(json: unknown): GeoHit[] {
  if (!Array.isArray(json)) return [];
  return (json as NominatimItem[]).flatMap((it) => {
    const lat = Number(it.lat);
    const lon = Number(it.lon);
    const display = (it.display_name ?? "").trim();
    const name = (it.name || display.split(",")[0] || "").trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return [];
    return [
      {
        name,
        display: display || name,
        lat,
        lon,
        country: it.address?.country ?? null,
        countryCode: it.address?.country_code ? it.address.country_code.toUpperCase() : null,
        kind: hitKind(it.addresstype, it.type, it.category),
        importance: typeof it.importance === "number" ? it.importance : 0.3,
        source: "nominatim" as const,
      },
    ];
  });
}

/** Photon's GeoJSON answer → hits. Pure. */
export function fromPhoton(json: unknown): GeoHit[] {
  const features = (json as { features?: PhotonFeature[] })?.features;
  if (!Array.isArray(features)) return [];
  return features.flatMap((f, i) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    const p = f.properties ?? {};
    if (typeof lat !== "number" || typeof lon !== "number" || !p.name) return [];
    const parts = [p.name, p.street, p.city, p.state, p.country].filter((x): x is string => Boolean(x));
    return [
      {
        name: p.name,
        display: [...new Set(parts)].join(", "),
        lat,
        lon,
        country: p.country ?? null,
        countryCode: p.countrycode ? p.countrycode.toUpperCase() : null,
        kind: p.osm_value || p.type || null,
        importance: Math.max(0.05, 0.5 - i * 0.05),
        source: "photon" as const,
      },
    ];
  });
}

/** Decode an encoded polyline (Google's algorithm; OSRM's polyline6 uses precision 6) into [lat, lon] pairs. Pure. */
/**
 * The neighbourhood name from a Nominatim reverse lookup ("Victoria Island"), or null. Where a
 * city maps its districts as towns (Lagos does), the town is the name people use. Pure.
 */
export function areaName(json: unknown): string | null {
  const a = (json as { address?: Record<string, unknown> } | null)?.address;
  if (!a) return null;
  const get = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim().slice(0, 60) : null);
  const town = get("town");
  if (town && town !== get("city")) return town;
  for (const k of ["suburb", "neighbourhood", "quarter", "city_district", "borough", "village", "county", "city"]) {
    const v = get(k);
    if (v) return v;
  }
  return null;
}

export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (index >= str.length) return null;
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < str.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

/** Douglas–Peucker simplification, tightened until the path has at most `max` points. Pure. */
export function simplifyPath(points: [number, number][], max = 300): [number, number][] {
  if (points.length <= max) return points;
  const simplify = (tol: number): [number, number][] => {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const [ay, ax] = points[a];
      const [by, bx] = points[b];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      let worst = -1;
      let worstD = 0;
      for (let i = a + 1; i < b; i++) {
        const [py, px] = points[i];
        const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
        const d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
        if (d > worstD) {
          worstD = d;
          worst = i;
        }
      }
      if (worst > 0 && worstD > tol * tol) {
        keep[worst] = 1;
        stack.push([a, worst], [worst, b]);
      }
    }
    return points.filter((_, i) => keep[i]);
  };
  let tol = 0.00005;
  let out = simplify(tol);
  while (out.length > max && tol < 1) {
    tol *= 2;
    out = simplify(tol);
  }
  return out;
}

/** One OSM element (type, id, coordinates, tags) → a place. Address parts may come from the tags or from Nominatim. Pure. */
function placeFromTags(
  type: string,
  osmId: number,
  name: string,
  lat: number,
  lon: number,
  category: string,
  t: Record<string, string>,
  addr: { street?: string; area?: string; city?: string } = {}
): OsmPlace {
  const starsRaw = parseFloat(t.stars ?? "");
  const stars = Number.isFinite(starsRaw) && starsRaw >= 1 && starsRaw <= 7 ? starsRaw : null;
  const cuisine = (t.cuisine ?? "")
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((c) => `${pretty(c)} cuisine`);
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || addr.street || "";
  const address = [street, t["addr:suburb"] || t["addr:district"] || addr.area, t["addr:city"] || addr.city].filter(Boolean).join(", ") || t["addr:full"] || null;
  const email = first(t.email || t["contact:email"]);
  return {
    id: `osm:${type[0]}${osmId}`,
    url: `https://www.openstreetmap.org/${type}/${osmId}`,
    name: name.slice(0, 120),
    lat,
    lon,
    category,
    tags: [pretty(category), stars ? `${stars}-star` : null, ...cuisine].filter((x): x is string => Boolean(x)),
    address: address ? address.slice(0, 200) : null,
    phone: first(t.phone || t["contact:phone"] || t["contact:mobile"])?.slice(0, 40) ?? null,
    email: email && EMAIL.test(email) ? email.slice(0, 120) : null,
    website: httpsUrl(t.website || t["contact:website"] || t.url),
    stars,
    hours: t.opening_hours ? t.opening_hours.slice(0, 120) : null,
  };
}

/** Overpass's answer → places with names and coordinates, de-duplicated. Pure. */
export function fromOverpass(json: unknown): OsmPlace[] {
  const els = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(els)) return [];
  const seen = new Set<string>();
  const out: OsmPlace[] = [];
  for (const el of els) {
    const t = el.tags ?? {};
    const name = (t["name:en"] || t.name || "").trim();
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!name || typeof lat !== "number" || typeof lon !== "number" || !el.type || el.id == null) continue;
    const dupKey = `${foldText(name)}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    const id = `osm:${el.type[0]}${el.id}`;
    if (seen.has(id) || seen.has(dupKey)) continue;
    seen.add(id);
    seen.add(dupKey);
    out.push(placeFromTags(el.type, el.id, name, lat, lon, t.tourism || t.amenity || t.leisure || t.historic || "place", t));
  }
  return out;
}

/** Nominatim's category-search answer (with extratags) → places. Pure. */
export function fromNominatimPlaces(json: unknown): OsmPlace[] {
  if (!Array.isArray(json)) return [];
  return (json as NominatimItem[]).flatMap((it) => {
    const lat = Number(it.lat);
    const lon = Number(it.lon);
    const name = (it.name || "").trim();
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !it.osm_type || it.osm_id == null) return [];
    const a = it.address ?? {};
    return [
      placeFromTags(it.osm_type, it.osm_id, name, lat, lon, it.type || it.category || "place", it.extratags ?? {}, {
        street: [a.house_number, a.road].filter(Boolean).join(" ") || undefined,
        area: a.suburb || a.neighbourhood,
        city: a.city || a.town,
      }),
    ];
  });
}

export class OsmClient {
  private readonly ua: string;
  private readonly geoCache = new TtlCache<GeoHit[]>(24 * 60 * 60 * 1000, 500);
  private readonly nearbyCache = new TtlCache<OsmPlace[]>(60 * 60 * 1000, 200);
  private readonly routeCache = new TtlCache<Route>(6 * 60 * 60 * 1000, 300);
  private readonly areaCache = new TtlCache<string>(24 * 60 * 60 * 1000, 300);
  private readonly gates = new Map<string, { gate: Promise<void>; last: number }>();

  constructor(private readonly config: OsmConfig = {}) {
    this.ua = config.userAgent?.trim() || DEFAULT_UA;
  }

  /** Wait for our turn so each service gets at most one request a second, even with parallel callers. */
  private async slot(service: string, signal?: AbortSignal): Promise<void> {
    const gap = this.config.minIntervalMs ?? 1100;
    const g = this.gates.get(service) ?? { gate: Promise.resolve(), last: 0 };
    this.gates.set(service, g);
    const prev = g.gate;
    let release!: () => void;
    g.gate = new Promise((r) => (release = r));
    try {
      await prev;
      const wait = g.last + gap - Date.now();
      if (wait > 0) await sleep(wait, signal);
      g.last = Date.now();
    } finally {
      release();
    }
  }

  private async http(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
    const f = this.config.fetch ?? fetch;
    const timeout = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await f(url, {
        ...init,
        headers: { "User-Agent": this.ua, Accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      throw new UpstreamError("maps", null, `Map service network error: ${(err as Error).message}`, "The map service didn't respond.");
    }
    if (!res.ok) throw new UpstreamError("maps", res.status, `Map service returned ${res.status}`, "The map service didn't respond.");
    return res.json();
  }

  private async nominatim(q: string, limit: number, near: { lat: number; lon: number } | undefined, radiusKm: number | undefined, signal?: AbortSignal): Promise<GeoHit[]> {
    const p = new URLSearchParams({ q, format: "jsonv2", limit: String(limit), addressdetails: "1", "accept-language": "en", dedupe: "1" });
    if (this.config.email) p.set("email", this.config.email);
    if (near && radiusKm) {
      const dLat = radiusKm / 111;
      const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((near.lat * Math.PI) / 180)));
      p.set("viewbox", `${(near.lon - dLon).toFixed(4)},${(near.lat + dLat).toFixed(4)},${(near.lon + dLon).toFixed(4)},${(near.lat - dLat).toFixed(4)}`);
      p.set("bounded", "1");
    }
    await this.slot("nominatim", signal);
    const base = (this.config.nominatimUrl || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
    return fromNominatim(await this.http(`${base}/search?${p}`, {}, signal, this.config.timeoutMs ?? 10000));
  }

  private async photon(q: string, limit: number, near: { lat: number; lon: number } | undefined, signal?: AbortSignal): Promise<GeoHit[]> {
    const p = new URLSearchParams({ q, limit: String(limit), lang: "en" });
    if (near) {
      p.set("lat", near.lat.toFixed(4));
      p.set("lon", near.lon.toFixed(4));
    }
    const base = (this.config.photonUrl || "https://photon.komoot.io").replace(/\/$/, "");
    return fromPhoton(await this.http(`${base}/api/?${p}`, {}, signal, this.config.timeoutMs ?? 10000));
  }

  /** The name of the neighbourhood at a point. */
  async reverse(at: { lat: number; lon: number }, signal?: AbortSignal): Promise<string | null> {
    const key = `${at.lat.toFixed(3)},${at.lon.toFixed(3)}`;
    const hit = this.areaCache.get(key);
    if (hit !== undefined) return hit;
    const p = new URLSearchParams({ lat: at.lat.toFixed(5), lon: at.lon.toFixed(5), format: "jsonv2", zoom: "12", "accept-language": "en" });
    if (this.config.email) p.set("email", this.config.email);
    await this.slot("nominatim", signal);
    const base = (this.config.nominatimUrl || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
    const name = areaName(await this.http(`${base}/reverse?${p}`, {}, signal, this.config.timeoutMs ?? 10000));
    if (name) this.areaCache.set(key, name);
    return name;
  }

  /**
   * Find a place on the map. With `near` and `radiusKm`, only places within that distance count
   * (used for landmarks inside a city). Tries spelling variants, then a second geocoder.
   */
  async geocode(query: string, opts: { near?: { lat: number; lon: number }; radiusKm?: number; limit?: number; signal?: AbortSignal } = {}): Promise<GeoHit[]> {
    const q = query.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!q) return [];
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
    const key = JSON.stringify([foldText(q), opts.near ? [opts.near.lat.toFixed(2), opts.near.lon.toFixed(2)] : null, opts.radiusKm ?? null, limit]);
    const hit = this.geoCache.get(key);
    if (hit) return hit;

    const within = (hits: GeoHit[]) => (opts.near && opts.radiusKm ? hits.filter((h) => distanceKm(opts.near!, h) <= opts.radiusKm!) : hits);
    let failure: unknown = null;
    let answered = false;
    for (const v of spellingVariants(q)) {
      try {
        const hits = within(await this.nominatim(v, limit, opts.near, opts.radiusKm, opts.signal));
        answered = true;
        if (hits.length) {
          this.geoCache.set(key, hits);
          return hits;
        }
      } catch (err) {
        failure = err;
        if (opts.signal?.aborted) throw err;
        break; // the service is unhappy: don't retry it with variants
      }
    }
    for (const v of spellingVariants(q)) {
      try {
        const hits = within(await this.photon(v, limit, opts.near, opts.signal));
        answered = true;
        if (hits.length) {
          this.geoCache.set(key, hits);
          return hits;
        }
      } catch (err) {
        failure = err;
        if (opts.signal?.aborted) throw err;
        break;
      }
    }
    if (!answered && failure) throw failure;
    this.geoCache.set(key, []);
    return [];
  }

  /**
   * Named places of one kind within `radiusM` metres of a point, nearest first. Overpass is the
   * most complete source but is often overloaded, so it gets one short attempt (a second server
   * only if the first refuses at once); then Nominatim's category search over the same area,
   * which is quick but returns only the most prominent places. Never takes longer than `budgetMs`.
   */
  async nearby(kind: OsmKind, at: { lat: number; lon: number }, radiusM: number, opts: { limit?: number; signal?: AbortSignal; budgetMs?: number } = {}): Promise<OsmPlace[]> {
    const r = Math.round(Math.min(Math.max(radiusM, 200), 30000));
    const limit = Math.min(Math.max(opts.limit ?? 120, 10), 200);
    const key = JSON.stringify([kind, at.lat.toFixed(4), at.lon.toFixed(4), r, limit]);
    const hit = this.nearbyCache.get(key);
    if (hit) return hit;
    const started = Date.now();
    const budget = opts.budgetMs ?? 10000;
    const left = () => budget - (Date.now() - started);
    const nearestFirst = (ps: OsmPlace[]) => ps.filter((p) => distanceKm(at, p) <= (r / 1000) * 1.1).sort((a, b) => distanceKm(at, a) - distanceKm(at, b));

    const around = `(around:${r},${at.lat.toFixed(5)},${at.lon.toFixed(5)})`;
    const query = `[out:json][timeout:8];(${OVERPASS_FILTERS[kind].map((f) => `nwr${f}["name"]${around};`).join("")});out center ${limit};`;
    const urls = this.config.overpassUrls?.length ? this.config.overpassUrls : ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
    let failure: unknown = null;
    for (const url of urls) {
      if (left() < 3000) break;
      const t0 = Date.now();
      try {
        const json = await this.http(
          url,
          { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }).toString() },
          opts.signal,
          Math.min(left() - 2000, 8000)
        );
        const places = nearestFirst(fromOverpass(json));
        this.nearbyCache.set(key, places);
        return places;
      } catch (err) {
        failure = err;
        if (opts.signal?.aborted) throw err;
        // A slow server won't be quicker elsewhere; only an instant refusal is worth a second try.
        if (Date.now() - t0 > 2500) break;
      }
    }

    // Fallback: Nominatim's category search ("[hotel]") bounded to the same area.
    const found: OsmPlace[] = [];
    let answered = false;
    for (const phrase of NOMINATIM_PHRASES[kind]) {
      if (left() < 1200) break;
      try {
        found.push(...(await this.categorySearch(phrase, at, r / 1000, opts.signal, Math.min(left(), 6000))));
        answered = true;
      } catch (err) {
        failure = err;
        if (opts.signal?.aborted) throw err;
        break;
      }
    }
    if (answered || !failure) {
      const byId = new Map(found.map((p) => [p.id, p]));
      const places = nearestFirst([...byId.values()]);
      // Cache the thin fallback briefly, so a recovered Overpass gets another chance soon.
      if (places.length) this.nearbyCache.set(key, places);
      return places;
    }
    throw failure;
  }

  /** Nominatim's search for one category of place ("[hotel]") inside a box around a point. */
  private async categorySearch(phrase: string, at: { lat: number; lon: number }, radiusKm: number, signal: AbortSignal | undefined, timeoutMs: number): Promise<OsmPlace[]> {
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((at.lat * Math.PI) / 180)));
    const p = new URLSearchParams({
      q: phrase,
      format: "jsonv2",
      limit: "40",
      bounded: "1",
      viewbox: `${(at.lon - dLon).toFixed(4)},${(at.lat + dLat).toFixed(4)},${(at.lon + dLon).toFixed(4)},${(at.lat - dLat).toFixed(4)}`,
      extratags: "1",
      addressdetails: "1",
      "accept-language": "en",
    });
    if (this.config.email) p.set("email", this.config.email);
    await this.slot("nominatim", signal);
    const base = (this.config.nominatimUrl || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
    return fromNominatimPlaces(await this.http(`${base}/search?${p}`, {}, signal, timeoutMs));
  }

  /** A road route through the points in order (2–10 points), with per-leg distance and time. */
  async route(points: { lat: number; lon: number }[], mode: RouteMode = "car", opts: { signal?: AbortSignal } = {}): Promise<Route> {
    const pts = points.slice(0, 10);
    if (pts.length < 2) throw new UpstreamError("maps", null, "A route needs two points", "A route needs at least two stops.");
    const coords = pts.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
    const key = `${mode}|${coords}`;
    const hit = this.routeCache.get(key);
    if (hit) return hit;
    const defaults: Record<RouteMode, string[]> = {
      car: ["https://routing.openstreetmap.de/routed-car/route/v1/driving", "https://router.project-osrm.org/route/v1/driving"],
      foot: ["https://routing.openstreetmap.de/routed-foot/route/v1/driving"],
    };
    const urls = this.config.routingUrls?.[mode]?.length ? this.config.routingUrls[mode]! : defaults[mode];
    let failure: unknown = null;
    for (const base of urls) {
      try {
        await this.slot(`route:${new URL(base).host}`, opts.signal);
        const json = (await this.http(`${base.replace(/\/$/, "")}/${coords}?overview=full&geometries=polyline6&steps=false`, {}, opts.signal, this.config.timeoutMs ?? 12000)) as {
          code?: string;
          routes?: { distance?: number; duration?: number; geometry?: string; legs?: { distance?: number; duration?: number }[] }[];
        };
        const r = json.routes?.[0];
        if (json.code !== "Ok" || !r || typeof r.distance !== "number" || typeof r.duration !== "number") throw new UpstreamError("maps", 422, `Routing returned ${json.code ?? "no route"}`, "No route was found between these stops.");
        const route: Route = {
          km: Math.round(r.distance / 100) / 10,
          minutes: Math.max(1, Math.round(r.duration / 60)),
          legs: (r.legs ?? []).map((l) => ({ km: Math.round((l.distance ?? 0) / 100) / 10, minutes: Math.max(1, Math.round((l.duration ?? 0) / 60)) })),
          path: simplifyPath(typeof r.geometry === "string" ? decodePolyline(r.geometry, 6) : [], 300),
        };
        this.routeCache.set(key, route);
        return route;
      } catch (err) {
        failure = err;
        if (opts.signal?.aborted) throw err;
      }
    }
    throw failure ?? new UpstreamError("maps", null, "No routing service answered", "Routing didn't respond.");
  }
}
