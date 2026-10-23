import { z } from "zod";
import type { QlooEntity } from "../clients/qloo";
import type { BriefInput, Evidence, Skill } from "../types";
import type { ArtistResolveOutput } from "./artist-resolve";
import { foldText } from "../util";

const THEME_MIN = 3;
const THEME_MAX = 12;
const CANDIDATE_MAX = 40;

// Tag types that describe taste. Tags about logistics (hotel stars, card types, prices) are noise.
const USEFUL_TAG = /genre|keyword|style|mood|theme|audience|subgenre|vibe|aesthetic/i;
const NOISE_TAG = /hotel|credit_card|price|rating|amenit|parking|payment|hours|cuisine_price/i;
const ARTIST_PROPS = ["adjectives_for_fans", "lyrical_themes", "characteristics", "primary_genres"] as const;

export type Candidate = { id: string; text: string; weight: number; source: string; entityId: string | null };

export const fansDnaOutput = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        description: z.string().max(200),
        strength: z.number().min(0).max(1),
        sources: z.array(z.string()).min(1),
      })
    )
    .min(1),
  candidates: z.array(z.object({ id: z.string(), text: z.string(), source: z.string() })),
  method: z.enum(["model", "fallback"]),
});
export type FansDnaOutput = z.infer<typeof fansDnaOutput>;

const modelSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        strength: z.number(),
        sources: z.array(z.string()),
      })
    )
    .min(1),
});

/** Property values come as strings, comma lists or arrays. Normalise to a list of short phrases. */
export function phrases(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\n]/) : [];
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 1 && v.length <= 60);
}

/** Gather and rank everything that might describe the fanbase's taste. Pure, so it's easy to test. */
export function buildCandidates(artist: ArtistResolveOutput["artist"], similar: QlooEntity[], tagged: QlooEntity[]): Candidate[] {
  const pool = new Map<string, Candidate>();
  const add = (text: string, weight: number, source: string, entityId: string | null) => {
    const key = foldText(text);
    if (!key) return;
    const existing = pool.get(key);
    if (existing) {
      existing.weight += weight;
      return;
    }
    pool.set(key, { id: "", text, weight, source, entityId });
  };

  for (const prop of ARTIST_PROPS) {
    for (const p of phrases(artist.properties[prop])) add(p, prop === "adjectives_for_fans" ? 3 : 2, `${artist.name} · ${prop.replace(/_/g, " ")}`, artist.id);
  }
  for (const s of similar.slice(0, 5)) {
    for (const p of phrases(s.properties.adjectives_for_fans)) add(p, 1.5 * (s.affinity ?? 0.5), `fans of ${s.name}`, s.id);
  }
  for (const e of tagged) {
    for (const t of e.tags) {
      if (!t.type || NOISE_TAG.test(t.type) || !USEFUL_TAG.test(t.type)) continue;
      add(t.name, e.affinity ?? 0.5, `tag on ${e.name}`, e.id);
    }
  }

  return [...pool.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, CANDIDATE_MAX)
    .map((c, i) => ({ ...c, id: `c${i + 1}` }));
}

/** Without a model: the strongest signals become themes directly. */
export function fallbackThemes(candidates: Candidate[]): FansDnaOutput["themes"] {
  const top = candidates.slice(0, 8);
  const max = top[0]?.weight || 1;
  return top.map((c) => ({ name: c.text.slice(0, 40), description: `From ${c.source}.`, strength: Math.round((c.weight / max) * 100) / 100, sources: [c.id] }));
}

export const fansDna: Skill<BriefInput, FansDnaOutput> = {
  id: "fans.dna",
  title: "Reading the fanbase's DNA",
  dependsOn: ["artist.resolve"],
  timeoutMs: 60_000,
  output: fansDnaOutput,
  async run(ctx, _input, deps) {
    const { artist } = deps["artist.resolve"].data as ArtistResolveOutput;

    // These calls overlap with fans.profile and are served from the client cache.
    const [similar, brands, movies, tv] = await Promise.all([
      ctx.qloo.insights("urn:entity:artist", { entityIds: [artist.id], take: 11 }, ctx.signal),
      ctx.qloo.insights("urn:entity:brand", { entityIds: [artist.id], take: 11 }, ctx.signal),
      ctx.qloo.insights("urn:entity:movie", { entityIds: [artist.id], take: 11 }, ctx.signal),
      ctx.qloo.insights("urn:entity:tv_show", { entityIds: [artist.id], take: 11 }, ctx.signal),
    ]);
    const others = (list: QlooEntity[]) => list.filter((e) => e.id !== artist.id);
    const candidates = buildCandidates(artist, others(similar), [...others(similar), ...others(brands), ...others(movies), ...others(tv)]);

    if (candidates.length === 0) {
      return {
        data: { themes: [{ name: "Not enough data", description: "There isn't enough taste data to describe this fanbase yet.", strength: 0, sources: ["none"] }], candidates: [], method: "fallback" },
        evidence: [],
        notes: ["Not enough taste data to describe this fanbase yet."],
      };
    }

    const byId = new Map(candidates.map((c) => [c.id, c]));
    let themes: FansDnaOutput["themes"] | null = null;
    let method: FansDnaOutput["method"] = "fallback";

    if (ctx.llm) {
      try {
        const out = await ctx.llm.json({
          tier: "fast",
          schema: modelSchema,
          maxTokens: 1200,
          temperature: 0.3,
          signal: ctx.signal,
          system: [
            "You analyse music fanbases for artist managers.",
            "You receive candidate signals about one artist's fans, each with an id. Group them into 6 to 10 themes that describe the fanbase's shared tastes.",
            "Rules: use only the signals given; every theme must list the ids of the signals it is based on; describe tastes, never infer sensitive traits (religion, ethnicity, health, politics, sexuality) about individuals; no clichés.",
            'Shape: {"themes":[{"name":"2-4 words","description":"one sentence, under 20 words","strength":0.0-1.0,"sources":["c1","c4"]}]}',
          ].join("\n"),
          user: `Artist: ${artist.name}\nSignals:\n${candidates.map((c) => `${c.id}: ${c.text} (from ${c.source})`).join("\n")}`,
        });
        // Groundedness: keep only real source ids; drop themes with none left.
        const grounded = out.themes
          .map((t) => ({
            name: t.name.trim().slice(0, 40),
            description: t.description.trim().slice(0, 200),
            strength: Math.max(0, Math.min(1, t.strength)),
            sources: [...new Set(t.sources.filter((s) => byId.has(s)))],
          }))
          .filter((t) => t.name && t.sources.length > 0)
          .slice(0, THEME_MAX);
        if (grounded.length >= THEME_MIN) {
          themes = grounded;
          method = "model";
        } else {
          ctx.log.warn("DNA model output not grounded enough; using fallback", { kept: grounded.length });
        }
      } catch (err) {
        ctx.log.warn("DNA model call failed; using fallback", { error: String(err) });
      }
    }
    if (!themes) themes = fallbackThemes(candidates);

    const used = new Set(themes.flatMap((t) => t.sources));
    const evidence: Evidence[] = [];
    const seen = new Set<string>();
    for (const id of used) {
      const c = byId.get(id);
      if (!c?.entityId || seen.has(`${c.entityId}:${c.text}`)) continue;
      seen.add(`${c.entityId}:${c.text}`);
      evidence.push({ source: "qloo", entityId: c.entityId, label: c.text, query: c.source });
    }

    return {
      data: { themes, candidates: candidates.map(({ id, text, source }) => ({ id, text, source })), method },
      evidence,
    };
  },
};
