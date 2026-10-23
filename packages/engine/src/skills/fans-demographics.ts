import { z } from "zod";
import type { BriefInput, Skill } from "../types";
import type { ArtistResolveOutput } from "./artist-resolve";

export const AGE_BANDS = [
  { band: "24_and_younger", label: "24 and under" },
  { band: "25_to_29", label: "25–29" },
  { band: "30_to_34", label: "30–34" },
  { band: "35_to_44", label: "35–44" },
  { band: "45_to_54", label: "45–54" },
  { band: "55_and_older", label: "55+" },
] as const;

export const fansDemographicsOutput = z.object({
  available: z.boolean(),
  ages: z.array(z.object({ band: z.string(), label: z.string(), index: z.number() })),
  strongestAge: z.string().nullable(),
  gender: z.object({
    male: z.number().nullable(),
    female: z.number().nullable(),
    lean: z.enum(["male", "female", "balanced"]).nullable(),
    strength: z.enum(["slight", "clear", "strong"]).nullable(),
  }),
});
export type FansDemographicsOutput = z.infer<typeof fansDemographicsOutput>;

/** Turn a male/female index pair (−1..1) into a plain-language lean. */
export function genderLean(male: number | null, female: number | null): Pick<FansDemographicsOutput["gender"], "lean" | "strength"> {
  if (male == null || female == null) return { lean: null, strength: null };
  const diff = male - female;
  const mag = Math.abs(diff);
  if (mag < 0.15) return { lean: "balanced", strength: null };
  return { lean: diff > 0 ? "male" : "female", strength: mag < 0.4 ? "slight" : mag < 0.8 ? "clear" : "strong" };
}

export const fansDemographics: Skill<BriefInput, FansDemographicsOutput> = {
  id: "fans.demographics",
  title: "Profiling who the fans are",
  dependsOn: ["artist.resolve"],
  timeoutMs: 20_000,
  output: fansDemographicsOutput,
  async run(ctx, _input, deps) {
    const { artist } = deps["artist.resolve"].data as ArtistResolveOutput;
    const rows = await ctx.qloo.demographics([artist.id], ctx.signal);
    ctx.usage.add("qloo", 1);
    const row = rows.find((r) => r.entityId === artist.id) ?? rows[0];

    if (!row || Object.keys(row.age).length === 0) {
      return {
        data: { available: false, ages: [], strongestAge: null, gender: { male: null, female: null, lean: null, strength: null } },
        evidence: [],
        notes: ["Age and gender data isn't available for this artist yet."],
      };
    }

    const ages = AGE_BANDS.filter((b) => typeof row.age[b.band] === "number").map((b) => ({ band: b.band, label: b.label, index: row.age[b.band] }));
    const strongest = ages.reduce<(typeof ages)[number] | null>((best, a) => (!best || a.index > best.index ? a : best), null);
    const male = typeof row.gender.male === "number" ? row.gender.male : null;
    const female = typeof row.gender.female === "number" ? row.gender.female : null;

    return {
      data: { available: true, ages, strongestAge: strongest?.label ?? null, gender: { male, female, ...genderLean(male, female) } },
      evidence: [{ source: "qloo", entityId: artist.id, label: `Audience of ${artist.name}`, query: `demographics · fans of ${artist.name}` }],
    };
  },
};
