// Qloo hackathon API client. Server-side only: the key must never reach a browser.
// Follows docs/qloo-api-notes.md (GET + query string, X-Api-Key header, hackathon base URL).
import { z } from "zod";
import { UpstreamError } from "../errors";
import { TtlCache, withRetry } from "../util";

export type QlooEntity = {
  id: string;
  name: string;
  /** e.g. "urn:entity:artist" (or the subtype for places, e.g. "urn:entity:place"). */
  type: string | null;
  affinity: number | null;
  popularity: number | null;
  image: string | null;
  location: { lat: number; lon: number } | null;
  tags: { id: string; name: string; type: string | null }[];
  /** Raw properties, kept so skills can read rich fields (e.g. adjectives_for_fans). */
  properties: Record<string, unknown>;
};

export type QlooTag = { id: string; name: string; type: string | null; affinity: number | null };

export type DemographicsRow = {
  entityId: string | null;
  age: Record<string, number>;
  gender: Record<string, number>;
};

export type HeatPoint = { lat: number; lon: number; geohash: string | null; affinity: number; popularity: number | null };

/** Optional extras for taste queries: tag signals alongside entity signals, and which tag types to return. */
export type TasteQuery = { tagIds?: string[]; tagTypes?: string[]; take?: number };

export type InsightType =
  | "urn:entity:artist"
  | "urn:entity:brand"
  | "urn:entity:movie"
  | "urn:entity:tv_show"
  | "urn:entity:book"
  | "urn:entity:podcast"
  | "urn:entity:destination"
  | "urn:entity:place"
  | "urn:entity:person";

export type InsightParams = {
  entityIds?: string[];
  tagIds?: string[];
  /** Filter results to a location (any city/region/country name). */
  filterLocation?: string;
  /** Bias results toward people in a location. */
  signalLocation?: string;
  filterTags?: string[];
  /** Filter to a radius around a point. Results are also distance-checked by the caller. */
  near?: { lat: number; lon: number; radiusKm: number };
  age?: "24_and_younger" | "25_to_29" | "30_to_34" | "35_to_44" | "45_to_54" | "55_and_older";
  take?: number;
};

type Config = { apiKey: string; baseUrl?: string; timeoutMs?: number; cacheTtlMs?: number };

// Lenient response schemas: we validate the parts we rely on and ignore the rest.
const tagSchema = z.object({ id: z.string().optional(), tag_id: z.string().optional(), name: z.string().optional(), type: z.string().optional() }).passthrough();
const entitySchema = z
  .object({
    entity_id: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    subtype: z.string().optional(),
    types: z.array(z.string()).optional(),
    popularity: z.number().optional(),
    query: z.object({ affinity: z.number().optional() }).passthrough().optional(),
    location: z.object({ lat: z.number(), lon: z.number() }).passthrough().optional(),
    tags: z.array(tagSchema).optional(),
    properties: z.record(z.unknown()).optional(),
  })
  .passthrough();

function toEntity(raw: unknown): QlooEntity | null {
  const parsed = entitySchema.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
  const id = e.entity_id || e.id;
  if (!id || !e.name) return null;
  const props = (e.properties || {}) as Record<string, unknown>;
  const img = props.image as { url?: string } | undefined;
  const type = e.subtype && e.subtype.startsWith("urn:entity:") ? e.subtype : e.types?.[0] || e.type || null;
  return {
    id,
    name: e.name,
    type,
    affinity: e.query?.affinity ?? null,
    popularity: e.popularity ?? null,
    image: typeof img?.url === "string" ? img.url : null,
    location: e.location ? { lat: e.location.lat, lon: e.location.lon } : null,
    tags: (e.tags || [])
      .map((t) => ({ id: t.id || t.tag_id || "", name: t.name || "", type: t.type ?? null }))
      .filter((t) => t.id && t.name),
    properties: props,
  };
}

function listFrom(json: unknown, key: string): unknown[] {
  const r = (json as { results?: unknown })?.results;
  if (Array.isArray(r)) return r;
  if (r && typeof r === "object") {
    const v = (r as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export class QlooClient {
  private readonly base: string;
  private readonly cache: TtlCache<unknown>;
  private calls = 0;

  constructor(private readonly config: Config) {
    if (!config.apiKey) throw new Error("QlooClient requires an API key");
    this.base = (config.baseUrl || "https://hackathon.api.qloo.com").replace(/\/$/, "");
    this.cache = new TtlCache(config.cacheTtlMs ?? 6 * 60 * 60 * 1000, 1000);
  }

  /** Number of network calls made (cache hits excluded). */
  get callCount(): number {
    return this.calls;
  }

  private async get(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<unknown> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const url = `${this.base}${path}?${qs}`;
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;

    const data = await withRetry(
      async () => {
        let res: Response;
        try {
          this.calls += 1;
          res = await fetch(url, {
            headers: { "X-Api-Key": this.config.apiKey, Accept: "application/json" },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs ?? 15000)]) : AbortSignal.timeout(this.config.timeoutMs ?? 15000),
            cache: "no-store",
          });
        } catch (err) {
          throw new UpstreamError("qloo", null, `Qloo ${path} network error: ${(err as Error).message}`);
        }
        if (!res.ok) {
          const userMessage = res.status === 401 ? "Taste data is unavailable: the Qloo key was rejected." : undefined;
          throw new UpstreamError("qloo", res.status, `Qloo ${path} returned ${res.status}`, userMessage);
        }
        return (await res.json()) as unknown;
      },
      { signal }
    );
    this.cache.set(url, data);
    return data;
  }

  /** Look up entities by name. */
  async search(query: string, opts: { types?: string[]; take?: number; signal?: AbortSignal } = {}): Promise<QlooEntity[]> {
    const json = await this.get("/search", { query, types: opts.types?.join(","), take: opts.take ?? 5 }, opts.signal);
    return listFrom(json, "entities").map(toEntity).filter((e): e is QlooEntity => e !== null);
  }

  /** Recommendations of one type from taste signals. */
  async insights(type: InsightType, p: InsightParams, signal?: AbortSignal): Promise<QlooEntity[]> {
    const json = await this.get(
      "/v2/insights",
      {
        "filter.type": type,
        "signal.interests.entities": p.entityIds?.join(","),
        "signal.interests.tags": p.tagIds?.join(","),
        "signal.location.query": p.signalLocation,
        "signal.demographics.age": p.age,
        "filter.location.query": p.filterLocation,
        "filter.tags": p.filterTags?.join(","),
        "filter.location": p.near ? `POINT(${p.near.lon} ${p.near.lat})` : undefined,
        "filter.location.radius": p.near ? Math.round(p.near.radiusKm * 1000) : undefined,
        take: p.take ?? 10,
      },
      signal
    );
    return listFrom(json, "entities").map(toEntity).filter((e): e is QlooEntity => e !== null);
  }

  /** Tags associated with the taste signals ("Taste Analysis"). */
  async tagInsights(entityIds: string[], take = 25, signal?: AbortSignal, q: TasteQuery = {}): Promise<QlooTag[]> {
    const json = await this.get(
      "/v2/insights",
      {
        "filter.type": "urn:tag",
        "signal.interests.entities": entityIds.join(","),
        "signal.interests.tags": q.tagIds?.join(","),
        "filter.tag.types": q.tagTypes?.join(","),
        take,
      },
      signal
    );
    return listFrom(json, "tags").flatMap((raw) => {
      const t = raw as { tag_id?: string; id?: string; name?: string; type?: string; subtype?: string; query?: { affinity?: number } };
      const id = t.tag_id || t.id;
      if (!id || !t.name) return [];
      return [{ id, name: t.name, type: t.subtype || t.type || null, affinity: typeof t.query?.affinity === "number" ? t.query.affinity : null }];
    });
  }

  /** Age and gender affinity of an audience. Values are indices from -1 to 1. */
  async demographics(entityIds: string[], signal?: AbortSignal, q: TasteQuery = {}): Promise<DemographicsRow[]> {
    const json = await this.get(
      "/v2/insights",
      { "filter.type": "urn:demographics", "signal.interests.entities": entityIds.join(","), "signal.interests.tags": q.tagIds?.join(",") },
      signal
    );
    return listFrom(json, "demographics").flatMap((raw) => {
      const r = raw as { entity_id?: string; query?: { age?: Record<string, unknown>; gender?: Record<string, unknown> } };
      const num = (o?: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o || {}).filter(([, v]) => typeof v === "number")) as Record<string, number>;
      return [{ entityId: r.entity_id ?? null, age: num(r.query?.age), gender: num(r.query?.gender) }];
    });
  }

  /** Geographic concentration of a taste within a location. */
  async heatmap(entityIds: string[], location: string, signal?: AbortSignal, q: TasteQuery = {}): Promise<HeatPoint[]> {
    const json = await this.get(
      "/v2/insights",
      { "filter.type": "urn:heatmap", "signal.interests.entities": entityIds.join(","), "signal.interests.tags": q.tagIds?.join(","), "filter.location.query": location },
      signal
    );
    return listFrom(json, "heatmap").flatMap((raw) => {
      const p = raw as { location?: { latitude?: number; longitude?: number; lat?: number; lon?: number; geohash?: string }; query?: { affinity?: number; popularity?: number } };
      const lat = p.location?.lat ?? p.location?.latitude;
      const lon = p.location?.lon ?? p.location?.longitude;
      const affinity = p.query?.affinity;
      if (typeof lat !== "number" || typeof lon !== "number" || typeof affinity !== "number") return [];
      return [{ lat, lon, geohash: p.location?.geohash ?? null, affinity, popularity: typeof p.query?.popularity === "number" ? p.query.popularity : null }];
    });
  }

  /** Find tag IDs by keyword (e.g. "music venue"). */
  async findTags(query: string, take = 5, signal?: AbortSignal): Promise<QlooTag[]> {
    const json = await this.get("/v2/tags", { "filter.query": query, take }, signal);
    return listFrom(json, "tags").flatMap((raw) => {
      const t = raw as { id?: string; tag_id?: string; name?: string; type?: string };
      const id = t.id || t.tag_id;
      return id && t.name ? [{ id, name: t.name, type: t.type ?? null, affinity: null }] : [];
    });
  }
}
