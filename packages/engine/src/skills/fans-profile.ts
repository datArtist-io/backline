import { z } from "zod";
import { EngineError } from "../errors";
import type { InsightType } from "../clients/qloo";
import type { BriefInput, Evidence, Skill } from "../types";
import type { ArtistResolveOutput } from "./artist-resolve";

// Categories supported by the hackathon API (video games are not; verified Oct 22).
export const PROFILE_CATEGORIES: { key: string; label: string; type: InsightType }[] = [
  { key: "artists", label: "Artists", type: "urn:entity:artist" },
  { key: "brands", label: "Brands", type: "urn:entity:brand" },
  { key: "movies", label: "Films", type: "urn:entity:movie" },
  { key: "tv", label: "TV", type: "urn:entity:tv_show" },
  { key: "books", label: "Books", type: "urn:entity:book" },
  { key: "podcasts", label: "Podcasts", type: "urn:entity:podcast" },
  { key: "destinations", label: "Travel", type: "urn:entity:destination" },
];

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  affinity: z.number().nullable(),
  popularity: z.number().nullable(),
  image: z.string().nullable(),
});

export const fansProfileOutput = z.object({
  categories: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      items: z.array(itemSchema),
      error: z.string().nullable(),
    })
  ),
});
export type FansProfileOutput = z.infer<typeof fansProfileOutput>;

export const PROFILE_TAKE = 10;

export const fansProfile: Skill<BriefInput, FansProfileOutput> = {
  id: "fans.profile",
  title: "Mapping what the fans love",
  dependsOn: ["artist.resolve"],
  timeoutMs: 30_000,
  output: fansProfileOutput,
  async run(ctx, _input, deps) {
    const { artist } = deps["artist.resolve"].data as ArtistResolveOutput;

    const settled = await Promise.allSettled(
      PROFILE_CATEGORIES.map((c) => ctx.qloo.insights(c.type, { entityIds: [artist.id], take: PROFILE_TAKE + 1 }, ctx.signal))
    );
    ctx.usage.add("qloo", PROFILE_CATEGORIES.length);

    const evidence: Evidence[] = [];
    const notes: string[] = [];
    const categories = PROFILE_CATEGORIES.map((c, i) => {
      const r = settled[i];
      if (r.status === "rejected") {
        const msg = r.reason instanceof EngineError ? r.reason.userMessage : "This category couldn't be loaded.";
        ctx.log.warn("Profile category failed", { category: c.key, error: String(r.reason) });
        notes.push(`${c.label}: ${msg}`);
        return { key: c.key, label: c.label, items: [], error: msg };
      }
      const items = r.value
        .filter((e) => e.id !== artist.id)
        .slice(0, PROFILE_TAKE)
        .map((e) => ({ id: e.id, name: e.name, affinity: e.affinity, popularity: e.popularity, image: e.image }));
      for (const it of items) {
        evidence.push({ source: "qloo", entityId: it.id, label: it.name, affinity: it.affinity ?? undefined, query: `${c.label.toLowerCase()} · fans of ${artist.name}` });
      }
      if (items.length === 0) notes.push(`${c.label}: no data for this artist yet.`);
      return { key: c.key, label: c.label, items, error: null };
    });

    if (categories.every((c) => c.items.length === 0)) {
      throw new EngineError("No profile data", `There isn't enough taste data for ${artist.name} yet.`);
    }
    return { data: { categories }, evidence, notes };
  },
};
