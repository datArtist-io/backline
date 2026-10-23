import { z } from "zod";
import type { BriefInput, Evidence, Skill } from "../types";
import { FactSheet, GROUNDING_RULES, artistFrom, languageRule, textList, textOf } from "../grounding";
import { EngineError } from "../errors";
import { mapLimit } from "../util";
import type { BrandMatchesOutput, BrandMatch } from "./brand-matches";
import type { BrandResearchOutput } from "./brand-research";
import type { FansDnaOutput } from "./fans-dna";
import type { FansDemographicsOutput } from "./fans-demographics";

const PITCH_MAX = 3;

export const brandPitchesOutput = z.object({
  pitches: z.array(
    z.object({
      brandId: z.string(),
      brandName: z.string(),
      subject: z.string(),
      hook: z.string(),
      body: z.string(),
      ask: z.string(),
      facts: z.array(z.object({ id: z.string(), text: z.string() })),
      contactRoute: z.string().nullable(),
      method: z.enum(["model", "template"]),
    })
  ),
});
export type BrandPitchesOutput = z.infer<typeof brandPitchesOutput>;

const modelSchema = z.object({
  subject: z.string().min(3),
  hook: z.string().min(3),
  body: z.string().min(40),
  ask: z.string().min(3),
  factsUsed: z.array(z.string()).min(1),
});

/** Which brands to pitch: the user's picks if any, otherwise the strongest new matches. */
export function pickBrands(matches: BrandMatch[], selected?: string[]): BrandMatch[] {
  if (selected && selected.length > 0) {
    const picked = selected.map((id) => matches.find((m) => m.id === id)).filter((m): m is BrandMatch => Boolean(m));
    if (picked.length > 0) return picked.slice(0, PITCH_MAX);
  }
  const fresh = matches.filter((m) => !m.alreadyPartnered);
  return (fresh.length > 0 ? fresh : matches).slice(0, PITCH_MAX);
}

export const brandPitches: Skill<BriefInput, BrandPitchesOutput> = {
  id: "brand.pitches",
  title: "Writing the pitches",
  dependsOn: ["artist.resolve", "brand.matches"],
  optionalDeps: ["brand.research", "fans.dna", "fans.demographics"],
  timeoutMs: 120_000,
  output: brandPitchesOutput,
  async run(ctx, input, deps) {
    const artist = artistFrom(deps);
    const { matches } = deps["brand.matches"].data as BrandMatchesOutput;
    const research = deps["brand.research"]?.data as BrandResearchOutput | undefined;
    const dna = deps["fans.dna"]?.data as FansDnaOutput | undefined;
    const demo = deps["fans.demographics"]?.data as FansDemographicsOutput | undefined;

    const brands = pickBrands(matches, input.selections?.brands);
    if (brands.length === 0) throw new EngineError("No brands to pitch", "There are no brand matches to pitch yet.");

    const artistEvidence: Evidence = { source: "qloo", entityId: artist.id, label: artist.name, query: `profile · ${artist.name}` };
    const evidence: Evidence[] = [];

    const pitches = await mapLimit(brands, 3, async (b) => {
      const facts = new FactSheet();
      const genres = textOf(artist.properties.primary_genres, 120);
      if (genres) facts.add(`${artist.name} makes ${genres}.`, artistEvidence);
      const desc = textOf(artist.properties.short_description, 240);
      if (desc) facts.add(desc, artistEvidence);
      for (const t of (dna?.themes ?? []).slice(0, 5)) facts.add(`Fan theme "${t.name}": ${t.description}`, { source: "derived", label: t.name, basis: `fan DNA of ${artist.name}` });
      if (demo?.available && demo.strongestAge) facts.add(`The fanbase over-indexes most at ages ${demo.strongestAge}.`, { source: "qloo", entityId: artist.id, label: `Audience of ${artist.name}`, query: "demographics" });
      if (demo?.gender.lean && demo.gender.lean !== "balanced") facts.add(`The fanbase leans ${demo.gender.strength ?? ""} ${demo.gender.lean}.`.replace(/\s+/g, " "), null);
      if (demo?.gender.lean === "balanced") facts.add("The fanbase is gender-balanced.", null);
      const brandEv: Evidence = { source: "qloo", entityId: b.id, label: b.name, affinity: b.affinity ?? undefined, query: `brands · fans of ${artist.name}` };
      for (const r of b.reasons) facts.add(r, brandEv);
      if (b.positioning) facts.add(`${b.name} positions itself as: ${b.positioning}`, brandEv);
      if (b.markets.length) facts.add(`${b.name}'s key markets: ${b.markets.join(", ")}.`, brandEv);
      const rb = research?.brands.find((x) => x.id === b.id);
      for (const f of rb?.findings ?? []) facts.add(`${b.name}: ${f.text}`, { source: "web", url: f.url, title: f.title, retrievedAt: new Date().toISOString() });
      if (rb?.angle) facts.add(`Why now: ${rb.angle}`, null);
      for (const other of textList(artist.properties.associated_brands, 3)) facts.add(`${artist.name} has been associated with ${other}.`, artistEvidence);

      let pitch: { subject: string; hook: string; body: string; ask: string; factsUsed: string[] } | null = null;
      let method: "model" | "template" = "template";
      if (ctx.llm) {
        try {
          const out = await ctx.llm.json({
            tier: "default",
            schema: modelSchema,
            maxTokens: 2400,
            temperature: 0.6,
            signal: ctx.signal,
            system: [
              "You are the head of brand partnerships at a music management company. Write a cold partnership pitch email from the artist's team to the brand's partnerships team.",
              GROUNDING_RULES,
              "The email: a specific subject line (under 70 characters); a one-sentence hook; a body under 170 words that leads with what the brand gets (an audience that already loves it), gives two or three concrete proof points from the facts, proposes one concrete partnership idea that fits both, and closes with a low-friction ask (a 20-minute call). Sign off as \"[Your name], on behalf of " +
                artist.name +
                '". No other placeholders. Do not claim an existing relationship with the brand.',
              languageRule(input),
              'Shape: {"subject":"…","hook":"…","body":"…","ask":"…","factsUsed":["f1","f3"]}',
            ].join("\n"),
            user: `Artist: ${artist.name}\nBrand: ${b.name}\n\nFacts:\n${facts.render()}`,
          });
          const used = facts.keep(out.factsUsed);
          if (used.length > 0) {
            pitch = { ...out, factsUsed: used };
            method = "model";
          }
        } catch (err) {
          ctx.log.warn("Pitch writing failed; using template", { brand: b.name, error: String(err) });
        }
      }
      if (!pitch) pitch = templatePitch(artist.name, b, facts);

      evidence.push(...facts.evidenceFor(pitch.factsUsed));
      return {
        brandId: b.id,
        brandName: b.name,
        subject: pitch.subject.trim().slice(0, 120),
        hook: pitch.hook.trim().slice(0, 300),
        body: pitch.body.trim().slice(0, 2500),
        ask: pitch.ask.trim().slice(0, 300),
        facts: facts.get(pitch.factsUsed).map(({ id, text }) => ({ id, text })),
        contactRoute: rb?.contactRoute ?? null,
        method,
      };
    });

    const seen = new Set<string>();
    const unique = evidence.filter((e) => {
      const k = JSON.stringify(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { data: { pitches }, evidence: unique };
  },
};

/** A plain, factual pitch for when no model is available. */
export function templatePitch(artistName: string, b: BrandMatch, facts: FactSheet) {
  const all = facts.all();
  const proof = all.filter((f) => f.text.includes(b.name) || f.text.startsWith("Fan theme") || f.text.includes("ages")).slice(0, 3);
  const body = [
    `Hi ${b.name} partnerships team,`,
    "",
    `${artistName}'s fans already love ${b.name}. Our taste data shows it clearly:`,
    ...proof.map((f) => `• ${f.text}`),
    "",
    `We'd like to explore a partnership that puts ${b.name} in front of an audience that's already a fan, from content to live moments.`,
    "",
    "Could we find 20 minutes in the next two weeks?",
    "",
    `[Your name], on behalf of ${artistName}`,
  ].join("\n");
  return {
    subject: `${artistName} × ${b.name}: an audience that already loves you`,
    hook: `${artistName}'s fans already over-index on ${b.name}.`,
    body,
    ask: "A 20-minute intro call in the next two weeks.",
    factsUsed: proof.map((f) => f.id),
  };
}
