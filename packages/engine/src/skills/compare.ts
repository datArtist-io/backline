import { z } from "zod";
import type { QlooEntity } from "../clients/qloo";
import type { BriefInput, Evidence, Skill } from "../types";
import { artistFrom } from "../grounding";
import { NotFoundError } from "../errors";
import { foldText } from "../util";
import { findArtistCandidates, normalizeArtistName, pickBest } from "./artist-resolve";
import { AGE_BANDS, type FansDemographicsOutput } from "./fans-demographics";

const ageVector = (age: Record<string, number>) => AGE_BANDS.map((b) => (typeof age[b.band] === "number" ? age[b.band] : 0));

/** Cosine similarity of two age-affinity vectors, mapped to 0..1. Pure. */
export function audienceSimilarity(a: number[], b: number[]): number | null {
  const dot = a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
  const na = Math.hypot(...a);
  const nb = Math.hypot(...b);
  if (na === 0 || nb === 0) return null;
  return Math.round(((dot / (na * nb) + 1) / 2) * 100) / 100;
}

// ---------- fans.segments ----------

export const fansSegmentsOutput = z.object({
  segments: z.array(
    z.object({
      band: z.string(),
      label: z.string(),
      index: z.number().nullable(),
      brands: z.array(z.object({ id: z.string(), name: z.string() })),
      artists: z.array(z.object({ id: z.string(), name: z.string() })),
      unique: z.array(z.string()),
    })
  ),
});
export type FansSegmentsOutput = z.infer<typeof fansSegmentsOutput>;

type Band = (typeof AGE_BANDS)[number]["band"];

export const fansSegments: Skill<BriefInput, FansSegmentsOutput> = {
  id: "fans.segments",
  title: "Splitting the fanbase into segments",
  dependsOn: ["artist.resolve"],
  optionalDeps: ["fans.demographics"],
  timeoutMs: 40_000,
  output: fansSegmentsOutput,
  async run(ctx, _input, deps) {
    const artist = artistFrom(deps);
    const demo = deps["fans.demographics"]?.data as FansDemographicsOutput | undefined;
    const ranked = (demo?.ages ?? []).slice().sort((a, b) => b.index - a.index);
    const picks: { band: Band; label: string; index: number | null }[] =
      ranked.length >= 2
        ? ranked.slice(0, 3).map((a) => ({ band: a.band as Band, label: a.label, index: a.index }))
        : [AGE_BANDS[0], AGE_BANDS[1], AGE_BANDS[3]].map((b) => ({ band: b.band, label: b.label, index: null }));

    const segs = await Promise.all(
      picks.map(async (p) => {
        const [brands, artists] = await Promise.all([
          ctx.qloo.insights("urn:entity:brand", { entityIds: [artist.id], age: p.band, take: 8 }, ctx.signal).catch(() => [] as QlooEntity[]),
          ctx.qloo.insights("urn:entity:artist", { entityIds: [artist.id], age: p.band, take: 9 }, ctx.signal).catch(() => [] as QlooEntity[]),
        ]);
        ctx.usage.add("qloo", 2);
        return { ...p, brands: brands.slice(0, 6).map((e) => ({ id: e.id, name: e.name })), artists: artists.filter((e) => e.id !== artist.id).slice(0, 6).map((e) => ({ id: e.id, name: e.name })) };
      })
    );
    // What each segment loves that the others don't: the useful part for targeting.
    const segments = segs.map((s) => {
      const others = new Set(segs.filter((o) => o !== s).flatMap((o) => [...o.brands, ...o.artists].map((e) => e.id)));
      return { ...s, unique: [...s.brands, ...s.artists].filter((e) => !others.has(e.id)).map((e) => e.name).slice(0, 5) };
    });
    const evidence: Evidence[] = segments.flatMap((s) =>
      [...s.brands, ...s.artists].map((e) => ({ source: "qloo" as const, entityId: e.id, label: e.name, query: `fans of ${artist.name} · ages ${s.label}` }))
    );
    const notes = segments.every((s) => s.brands.length + s.artists.length === 0) ? ["No segment data for this artist yet."] : [];
    return { data: { segments }, evidence, notes };
  },
};

// ---------- compare.artists ----------

export const compareArtistsOutput = z.object({
  applicable: z.boolean(),
  rival: z.object({ id: z.string(), name: z.string(), image: z.string().nullable() }).nullable(),
  similarity: z.number().nullable(),
  shared: z.array(z.string()),
  onlyArtist: z.array(z.string()),
  onlyRival: z.array(z.string()),
  ages: z.array(z.object({ label: z.string(), artist: z.number().nullable(), rival: z.number().nullable() })),
  takeaways: z.array(z.string()),
});
export type CompareArtistsOutput = z.infer<typeof compareArtistsOutput>;

const NOT_APPLICABLE: CompareArtistsOutput = { applicable: false, rival: null, similarity: null, shared: [], onlyArtist: [], onlyRival: [], ages: [], takeaways: [] };

/** Split two ranked lists into shared and unique names. Pure. */
export function overlap(a: QlooEntity[], b: QlooEntity[]) {
  const bIds = new Set(b.map((e) => e.id));
  const aIds = new Set(a.map((e) => e.id));
  return { shared: a.filter((e) => bIds.has(e.id)).map((e) => e.name), onlyA: a.filter((e) => !bIds.has(e.id)).map((e) => e.name), onlyB: b.filter((e) => !aIds.has(e.id)).map((e) => e.name) };
}

export const compareArtists: Skill<BriefInput, CompareArtistsOutput> = {
  id: "compare.artists",
  title: "Comparing with the other artist",
  dependsOn: ["artist.resolve"],
  timeoutMs: 40_000,
  output: compareArtistsOutput,
  async run(ctx, input, deps) {
    if (!input.compareWith?.trim()) return { data: NOT_APPLICABLE, evidence: [] };
    const artist = artistFrom(deps);
    const name = normalizeArtistName(input.compareWith);
    const rival = pickBest(name, (await findArtistCandidates(ctx, name)).filter((c) => c.id !== artist.id));
    if (!rival) throw new NotFoundError(`We couldn't find "${name}" in the taste data to compare with.`);

    const [aBrands, rBrands, aArtists, rArtists, aDemo, rDemo] = await Promise.all([
      ctx.qloo.insights("urn:entity:brand", { entityIds: [artist.id], take: 15 }, ctx.signal),
      ctx.qloo.insights("urn:entity:brand", { entityIds: [rival.id], take: 15 }, ctx.signal),
      ctx.qloo.insights("urn:entity:artist", { entityIds: [artist.id], take: 15 }, ctx.signal),
      ctx.qloo.insights("urn:entity:artist", { entityIds: [rival.id], take: 15 }, ctx.signal),
      ctx.qloo.demographics([artist.id], ctx.signal).catch(() => []),
      ctx.qloo.demographics([rival.id], ctx.signal).catch(() => []),
    ]);
    ctx.usage.add("qloo", 6);

    const ids = new Set([artist.id, rival.id]);
    const strip = (l: QlooEntity[]) => l.filter((e) => !ids.has(e.id));
    const b = overlap(strip(aBrands), strip(rBrands));
    const a = overlap(strip(aArtists), strip(rArtists));
    const ageA = aDemo[0]?.age ?? {};
    const ageR = rDemo[0]?.age ?? {};
    const similarity = audienceSimilarity(ageVector(ageA), ageVector(ageR));
    const ages = AGE_BANDS.map((x) => ({ label: x.label, artist: typeof ageA[x.band] === "number" ? ageA[x.band] : null, rival: typeof ageR[x.band] === "number" ? ageR[x.band] : null }));

    const takeaways: string[] = [];
    const sharedAll = [...b.shared, ...a.shared];
    if (sharedAll.length) takeaways.push(`Both fanbases love ${sharedAll.slice(0, 3).join(", ")}: common ground for a joint moment or a brand you can both pitch.`);
    if (b.onlyB.length) takeaways.push(`${rival.name}'s fans lean into ${b.onlyB.slice(0, 3).join(", ")}, which ${artist.name}'s fans don't: a sign of where their audience is different.`);
    if (b.onlyA.length) takeaways.push(`${artist.name} owns ${b.onlyA.slice(0, 3).join(", ")} in this comparison: lead with these in pitches.`);
    if (similarity != null) takeaways.push(`Age profiles are ${similarity >= 0.8 ? "very similar" : similarity >= 0.6 ? "somewhat similar" : "quite different"} (similarity ${similarity.toFixed(2)} of 1).`);

    const evidence: Evidence[] = [
      { source: "qloo", entityId: rival.id, label: rival.name, query: `search · "${name}"` },
      ...strip([...aBrands, ...rBrands]).slice(0, 20).map((e) => ({ source: "qloo" as const, entityId: e.id, label: e.name, affinity: e.affinity ?? undefined, query: `brands · fans of ${artist.name} vs ${rival.name}` })),
    ];
    return {
      data: { applicable: true, rival: { id: rival.id, name: rival.name, image: rival.image }, similarity, shared: sharedAll.slice(0, 10), onlyArtist: [...b.onlyA, ...a.onlyA].slice(0, 10), onlyRival: [...b.onlyB, ...a.onlyB].slice(0, 10), ages, takeaways },
      evidence,
    };
  },
};

// ---------- compare.brands ----------

export const compareBrandsOutput = z.object({
  applicable: z.boolean(),
  brands: z.array(
    z.object({
      query: z.string(),
      id: z.string().nullable(),
      name: z.string(),
      image: z.string().nullable(),
      rank: z.number().nullable(),
      affinity: z.number().nullable(),
      audienceMatch: z.number().nullable(),
    })
  ),
  winner: z.string().nullable(),
  verdict: z.string(),
});
export type CompareBrandsOutput = z.infer<typeof compareBrandsOutput>;

/** Pick the better brand: taste rank first (lower is better), audience match second. Pure. */
export function pickWinner(rows: { name: string; rank: number | null; audienceMatch: number | null }[]): string | null {
  const score = (r: (typeof rows)[number]) => (r.rank != null ? 1 - Math.min(r.rank, 50) / 50 : 0) * 0.7 + (r.audienceMatch ?? 0) * 0.3;
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  if (sorted.length < 2 || score(sorted[0]) === score(sorted[1])) return null;
  return sorted[0].name;
}

export const compareBrands: Skill<BriefInput, CompareBrandsOutput> = {
  id: "compare.brands",
  title: "Weighing the brands head-to-head",
  dependsOn: ["artist.resolve"],
  timeoutMs: 40_000,
  output: compareBrandsOutput,
  async run(ctx, input, deps) {
    const names = (input.compareBrands ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 3);
    if (names.length < 2) return { data: { applicable: false, brands: [], winner: null, verdict: "" }, evidence: [] };
    const artist = artistFrom(deps);

    const [ranked, artistDemo, ...found] = await Promise.all([
      ctx.qloo.insights("urn:entity:brand", { entityIds: [artist.id], take: 50 }, ctx.signal),
      ctx.qloo.demographics([artist.id], ctx.signal).catch(() => []),
      ...names.map((n) => ctx.qloo.search(n, { types: ["urn:entity:brand"], take: 3, signal: ctx.signal }).catch(() => [] as QlooEntity[])),
    ]);
    ctx.usage.add("qloo", 2 + names.length);
    const artistAge = ageVector(artistDemo[0]?.age ?? {});

    const brands = await Promise.all(
      names.map(async (q, i) => {
        const list = found[i] as QlooEntity[];
        const hit = list.find((e) => foldText(e.name) === foldText(q)) ?? list[0];
        if (!hit) return { query: q, id: null, name: q, image: null, rank: null, affinity: null, audienceMatch: null };
        const idx = ranked.findIndex((e) => e.id === hit.id);
        const demo = await ctx.qloo.demographics([hit.id], ctx.signal).catch(() => []);
        ctx.usage.add("qloo", 1);
        return {
          query: q,
          id: hit.id,
          name: hit.name,
          image: hit.image,
          rank: idx >= 0 ? idx + 1 : null,
          affinity: idx >= 0 ? ranked[idx].affinity : null,
          audienceMatch: audienceSimilarity(artistAge, ageVector(demo[0]?.age ?? {})),
        };
      })
    );
    const winner = pickWinner(brands);
    const describe = (b: (typeof brands)[number]) =>
      `${b.name}: ${b.rank ? `#${b.rank} among brands ${artist.name}'s fans love` : "not in the fans' top 50 brands"}${b.audienceMatch != null ? `, audience age match ${b.audienceMatch.toFixed(2)}` : ""}`;
    const verdict = winner ? `${winner} is the stronger fit. ${brands.map(describe).join("; ")}.` : `Too close to call on the data. ${brands.map(describe).join("; ")}.`;
    const evidence: Evidence[] = brands.filter((b) => b.id).map((b) => ({ source: "qloo", entityId: b.id!, label: b.name, affinity: b.affinity ?? undefined, query: `brands · fans of ${artist.name} (top 50) and brand demographics` }));
    const notes = brands.filter((b) => !b.id).map((b) => `Couldn't find "${b.query}" in the brand data.`);
    return { data: { applicable: true, brands, winner, verdict }, evidence, notes };
  },
};
