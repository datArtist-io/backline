import { z } from "zod";
import type { QlooEntity } from "../clients/qloo";
import type { BriefInput, Evidence, Skill } from "../types";
import { artistFrom, textList, webEvidence } from "../grounding";
import { foldText, mapLimit } from "../util";
import type { FansProfileOutput } from "./fans-profile";

// ---------- growth.collaborators ----------

const collaborator = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  affinity: z.number().nullable(),
  tier: z.enum(["reach", "peer", "rising"]),
  sharedGenres: z.array(z.string()),
  reason: z.string(),
});
export const growthCollaboratorsOutput = z.object({ collaborators: z.array(collaborator) });
export type GrowthCollaboratorsOutput = z.infer<typeof growthCollaboratorsOutput>;

/** Bigger artists are a "reach", similar-sized are peers, smaller are rising. Pure. */
export function collabTier(artistPop: number | null, otherPop: number | null): "reach" | "peer" | "rising" {
  if (artistPop == null || otherPop == null) return "peer";
  const d = otherPop - artistPop;
  return d > 0.05 ? "reach" : d < -0.05 ? "rising" : "peer";
}

export const growthCollaborators: Skill<BriefInput, GrowthCollaboratorsOutput> = {
  id: "growth.collaborators",
  title: "Finding collaborators who share the fans",
  dependsOn: ["artist.resolve"],
  timeoutMs: 30_000,
  output: growthCollaboratorsOutput,
  async run(ctx, _input, deps) {
    const artist = artistFrom(deps);
    const similar = await ctx.qloo.insights("urn:entity:artist", { entityIds: [artist.id], take: 21 }, ctx.signal);
    ctx.usage.add("qloo", 1);
    const myGenres = new Map(textList(artist.properties.primary_genres, 10).map((g) => [foldText(g), g]));
    const tierLabel = { reach: "a step up in reach", peer: "a peer at a similar level", rising: "a rising act you can bring along" } as const;

    const collaborators = similar
      .filter((s) => s.id !== artist.id && foldText(s.name) !== foldText(artist.name))
      .slice(0, 12)
      .map((s: QlooEntity) => {
        const theirs = textList(s.properties.primary_genres, 10);
        const shared = theirs.filter((g) => myGenres.has(foldText(g)));
        const tier = collabTier(artist.popularity, s.popularity);
        const aff = s.affinity != null ? ` (affinity ${s.affinity.toFixed(2)})` : "";
        return {
          id: s.id,
          name: s.name,
          image: s.image,
          affinity: s.affinity,
          tier,
          sharedGenres: shared,
          reason: `Fans overlap strongly${aff}; ${tierLabel[tier]}${shared.length ? `; both make ${shared.slice(0, 2).join(" and ")}` : ""}.`,
        };
      });
    const evidence: Evidence[] = collaborators.map((c) => ({ source: "qloo", entityId: c.id, label: c.name, affinity: c.affinity ?? undefined, query: `artists · fans of ${artist.name}` }));
    return { data: { collaborators }, evidence, notes: collaborators.length ? [] : ["No similar-artist data yet."] };
  },
};

// ---------- growth.markets ----------

export const growthMarketsOutput = z.object({
  home: z.string().nullable(),
  markets: z.array(z.object({ id: z.string(), name: z.string(), affinity: z.number().nullable(), image: z.string().nullable() })),
});
export type GrowthMarketsOutput = z.infer<typeof growthMarketsOutput>;

export const growthMarkets: Skill<BriefInput, GrowthMarketsOutput> = {
  id: "growth.markets",
  title: "Spotting new markets",
  dependsOn: ["artist.resolve"],
  timeoutMs: 30_000,
  output: growthMarketsOutput,
  async run(ctx, input, deps) {
    const artist = artistFrom(deps);
    const home = typeof artist.properties.place_of_birth === "string" ? artist.properties.place_of_birth : null;
    const raw = await ctx.qloo.insights("urn:entity:destination", { entityIds: [artist.id], take: 25 }, ctx.signal);
    ctx.usage.add("qloo", 1);
    const exclude = [home, input.location].filter((x): x is string => Boolean(x)).flatMap((x) => x.split(",")).map(foldText).filter((x) => x.length > 2);
    const markets = raw
      .filter((d) => d.id !== artist.id)
      .filter((d) => !exclude.some((x) => foldText(d.name).includes(x) || x.includes(foldText(d.name))))
      .slice(0, 8)
      .map((d) => ({ id: d.id, name: d.name, affinity: d.affinity, image: d.image }));
    const evidence: Evidence[] = markets.map((m) => ({ source: "qloo", entityId: m.id, label: m.name, affinity: m.affinity ?? undefined, query: `destinations · fans of ${artist.name}` }));
    const notes = ["Places outside the artist's home base where this fanbase's taste over-indexes: candidates for playlist pitching, ads and a first show."];
    return { data: { home, markets }, evidence, notes };
  },
};

// ---------- growth.press ----------

export const growthPressOutput = z.object({
  podcasts: z.array(z.object({ id: z.string(), name: z.string(), affinity: z.number().nullable() })),
  outlets: z.array(z.object({ domain: z.string(), covered: z.array(z.string()), examples: z.array(z.object({ title: z.string(), url: z.string() })) })),
  webEnabled: z.boolean(),
});
export type GrowthPressOutput = z.infer<typeof growthPressOutput>;

const SKIP_DOMAINS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|apple\.com|instagram\.com|facebook\.com|tiktok\.com|x\.com|twitter\.com|wikipedia\.org|genius\.com|soundcloud\.com|amazon\.|reddit\.com)$/i;

export const growthPress: Skill<BriefInput, GrowthPressOutput> = {
  id: "growth.press",
  title: "Finding press and podcasts to pitch",
  dependsOn: ["artist.resolve"],
  optionalDeps: ["fans.profile", "growth.collaborators"],
  timeoutMs: 60_000,
  output: growthPressOutput,
  async run(ctx, _input, deps) {
    const artist = artistFrom(deps);
    const profile = deps["fans.profile"]?.data as FansProfileOutput | undefined;
    const collabs = (deps["growth.collaborators"]?.data as GrowthCollaboratorsOutput | undefined)?.collaborators ?? [];
    const evidence: Evidence[] = [];
    const notes: string[] = [];

    let podcastItems = profile?.categories.find((c) => c.key === "podcasts")?.items;
    if (!podcastItems) {
      const raw = await ctx.qloo.insights("urn:entity:podcast", { entityIds: [artist.id], take: 10 }, ctx.signal);
      ctx.usage.add("qloo", 1);
      podcastItems = raw.map((p) => ({ id: p.id, name: p.name, affinity: p.affinity, popularity: p.popularity, image: p.image }));
    }
    const podcasts = podcastItems.slice(0, 8).map((p) => ({ id: p.id, name: p.name, affinity: p.affinity }));
    for (const p of podcasts) evidence.push({ source: "qloo", entityId: p.id, label: p.name, affinity: p.affinity ?? undefined, query: `podcasts · fans of ${artist.name}` });

    const outlets = new Map<string, { domain: string; covered: Set<string>; examples: { title: string; url: string }[] }>();
    if (ctx.web) {
      const peers = collabs.filter((c) => c.tier !== "reach").slice(0, 3).map((c) => c.name);
      const names = peers.length ? peers : collabs.slice(0, 3).map((c) => c.name);
      await mapLimit(names, 3, async (name) => {
        try {
          const results = await ctx.web!.search(`${name} interview`, { maxResults: 6, signal: ctx.signal });
          ctx.usage.add("web", 1);
          for (const r of results) {
            const domain = new URL(r.url).hostname.replace(/^www\./, "");
            if (SKIP_DOMAINS.test(domain)) continue;
            const o = outlets.get(domain) ?? { domain, covered: new Set<string>(), examples: [] };
            o.covered.add(name);
            if (o.examples.length < 2) {
              o.examples.push({ title: r.title, url: r.url });
              evidence.push(webEvidence(r));
            }
            outlets.set(domain, o);
          }
        } catch (err) {
          ctx.log.warn("Press search failed", { name, error: String(err) });
        }
      });
    } else {
      notes.push("Live web research is off, so only podcasts from the taste data are listed.");
    }
    const outletList = [...outlets.values()]
      .sort((a, b) => b.covered.size - a.covered.size)
      .slice(0, 8)
      .map((o) => ({ domain: o.domain, covered: [...o.covered], examples: o.examples }));
    notes.push("Podcasts are ones this fanbase over-indexes on. Outlets have recently covered artists who share the fans.");
    return { data: { podcasts, outlets: outletList, webEnabled: Boolean(ctx.web) }, evidence, notes };
  },
};
