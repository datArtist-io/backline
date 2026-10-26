import { z } from "zod";
import type { QlooEntity } from "../clients/qloo";
import type { BriefInput, Evidence, Skill } from "../types";
import { artistFrom, textList, textOf } from "../grounding";
import { foldText } from "../util";
import type { FansDemographicsOutput } from "./fans-demographics";

const MUSIC_WORDS = /music|musician|artist|concert|festival|tour|singer|rapper|band|album|spotify|grammy|afrobeats|hip.?hop|dj/i;

export const brandMatchesOutput = z.object({
  focus: z.string().nullable(),
  focusApplied: z.boolean(),
  matches: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      image: z.string().nullable(),
      affinity: z.number().nullable(),
      fit: z.number().min(0).max(1),
      reasons: z.array(z.string()).min(1),
      alreadyPartnered: z.boolean(),
      positioning: z.string().nullable(),
      markets: z.array(z.string()),
      targetAge: z.string().nullable(),
      partnerships: z.array(z.string()),
    })
  ),
});
export type BrandMatchesOutput = z.infer<typeof brandMatchesOutput>;
export type BrandMatch = BrandMatchesOutput["matches"][number];

/** Parse "18-34", "25 to 44", "18+" into a numeric range. */
export function ageRange(text: string | null): [number, number] | null {
  if (!text) return null;
  const nums = (text.match(/\d{2}/g) || []).map(Number);
  if (nums.length === 0) return null;
  if (nums.length === 1) return /\+|and older|older|over/i.test(text) ? [nums[0], 99] : /under|younger|and under/i.test(text) ? [0, nums[0]] : [nums[0], nums[0]];
  return [Math.min(...nums), Math.max(...nums)];
}

export function rangesOverlap(a: [number, number] | null, b: [number, number] | null): boolean {
  return !!a && !!b && a[0] <= b[1] && b[0] <= a[1];
}

/** Score one brand for one artist. Pure, so it's easy to test. */
export function scoreBrand(
  brand: QlooEntity,
  ctx: { artistName: string; associated: Set<string>; strongestAge: string | null; location: string | null }
): BrandMatch {
  const p = brand.properties;
  const positioning = textOf(p.market_positioning);
  const markets = textList(p.key_markets, 6);
  const targetAge = textOf(p.target_age_group, 60);
  const partnerships = textList(p.known_partnerships, 6);
  const affinity = brand.affinity;

  const reasons: string[] = [];
  let fit = (affinity ?? 0.4) * 0.7;
  reasons.push(
    affinity != null
      ? `${ctx.artistName}'s fans have a strong taste match with ${brand.name} (affinity ${affinity.toFixed(2)} of 1).`
      : `${brand.name} appears among the brands ${ctx.artistName}'s fans like.`
  );

  const musicHistory = partnerships.filter((x) => MUSIC_WORDS.test(x));
  if (musicHistory.length > 0 || MUSIC_WORDS.test(positioning ?? "")) {
    fit += 0.15;
    reasons.push(musicHistory.length > 0 ? `Has partnered with music before: ${musicHistory.slice(0, 2).join(", ")}.` : `Already positions itself around music.`);
  }
  if (rangesOverlap(ageRange(targetAge), ageRange(ctx.strongestAge))) {
    fit += 0.1;
    reasons.push(`Targets ${targetAge}, which overlaps the artist's strongest fan age group (${ctx.strongestAge}).`);
  }
  if (ctx.location) {
    const locParts = ctx.location.split(",").map(foldText).filter(Boolean);
    const hit = markets.find((m) => locParts.some((l) => foldText(m).includes(l) || l.includes(foldText(m))));
    if (hit) {
      fit += 0.05;
      reasons.push(`Active in ${hit}.`);
    }
  }

  const name = foldText(brand.name);
  const alreadyPartnered = [...ctx.associated].some((a) => a === name || (a.length > 3 && (a.includes(name) || name.includes(a))));
  if (alreadyPartnered) reasons.push(`Already associated with ${ctx.artistName}: worth a renewal or extension, not a cold pitch.`);

  return {
    id: brand.id,
    name: brand.name,
    image: brand.image,
    affinity,
    fit: Math.round(Math.min(1, fit) * 100) / 100,
    reasons,
    alreadyPartnered,
    positioning,
    markets,
    targetAge,
    partnerships,
  };
}

export const brandMatches: Skill<BriefInput, BrandMatchesOutput> = {
  id: "brand.matches",
  title: "Finding brands the fans already love",
  dependsOn: ["artist.resolve"],
  optionalDeps: ["fans.demographics"],
  timeoutMs: 30_000,
  output: brandMatchesOutput,
  async run(ctx, input, deps) {
    const artist = artistFrom(deps);
    const demo = deps["fans.demographics"]?.data as FansDemographicsOutput | undefined;
    const focus = input.focus?.trim() || null;
    const notes: string[] = [];

    // A focus like "sportswear" becomes a brand tag filter when Qloo has a matching tag.
    let filterTags: string[] | undefined;
    if (focus) {
      try {
        const tags = await ctx.qloo.findTags(focus, 8, ctx.signal);
        ctx.usage.add("qloo", 1);
        const brandTags = tags.filter((t) => /brand/i.test(`${t.type ?? ""} ${t.id}`));
        if (brandTags.length > 0) filterTags = brandTags.slice(0, 3).map((t) => t.id);
      } catch (err) {
        ctx.log.warn("Tag lookup failed", { error: String(err) });
      }
    }

    let raw = await ctx.qloo.insights("urn:entity:brand", { entityIds: [artist.id], filterTags, take: 25 }, ctx.signal);
    ctx.usage.add("qloo", 1);
    let focusApplied = Boolean(filterTags);
    if (filterTags && raw.length === 0) {
      raw = await ctx.qloo.insights("urn:entity:brand", { entityIds: [artist.id], take: 25 }, ctx.signal);
      ctx.usage.add("qloo", 1);
      focusApplied = false;
    }
    if (focus && !focusApplied) notes.push(`No brand category matching "${focus}" in the taste data, so these are the strongest matches overall.`);

    const associated = new Set(textList(artist.properties.associated_brands, 30).map(foldText));
    const matches = raw
      .filter((b) => b.id !== artist.id)
      .map((b) => scoreBrand(b, { artistName: artist.name, associated, strongestAge: demo?.strongestAge ?? null, location: input.location ?? null }))
      .sort((a, b) => Number(a.alreadyPartnered) - Number(b.alreadyPartnered) || b.fit - a.fit)
      .slice(0, 12);

    if (matches.length === 0) notes.push(`No brand data for ${artist.name}'s fans yet.`);
    const evidence: Evidence[] = matches.map((m) => ({
      source: "qloo",
      entityId: m.id,
      label: m.name,
      affinity: m.affinity ?? undefined,
      query: `brands · fans of ${artist.name}${focusApplied ? ` · ${focus}` : ""}`,
    }));
    return { data: { focus, focusApplied, matches }, evidence, notes };
  },
};
