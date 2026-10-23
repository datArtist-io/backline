import { z } from "zod";
import { InputError, NotFoundError, UpstreamError } from "../errors";
import type { QlooEntity } from "../clients/qloo";
import type { BriefInput, Skill, SkillContext } from "../types";
import { foldText } from "../util";

// Artist properties worth keeping for later skills (fan DNA, pitches). Others are dropped.
const KEEP_PROPS = [
  "short_description",
  "primary_genres",
  "secondary_genres",
  "adjectives_for_fans",
  "lyrical_themes",
  "characteristics",
  "associated_brands",
  "place_of_birth",
  "start_year",
] as const;

const artistSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  image: z.string().nullable(),
  popularity: z.number().nullable(),
  properties: z.record(z.unknown()),
});

export const artistResolveOutput = z.object({
  artist: artistSchema,
  alternatives: z.array(z.object({ id: z.string(), name: z.string(), image: z.string().nullable() })),
});
export type ArtistResolveOutput = z.infer<typeof artistResolveOutput>;

export function normalizeArtistName(raw: string): string {
  const s = (raw || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!s) throw new InputError("Enter an artist name.");
  if (s.length > 120) throw new InputError("Artist name is too long.");
  if (!/\p{L}|\p{N}/u.test(s)) throw new InputError("Enter a valid artist name.");
  return s;
}

/** Prefer an exact (accent- and case-insensitive) name match; otherwise trust Qloo's ranking. */
export function pickBest(query: string, candidates: QlooEntity[]): QlooEntity | null {
  if (candidates.length === 0) return null;
  const q = foldText(query);
  return candidates.find((c) => foldText(c.name) === q) ?? candidates[0];
}

/** Search for an artist by name: typed search first, then untyped (some artists are indexed as people). */
export async function findArtistCandidates(ctx: SkillContext, name: string): Promise<QlooEntity[]> {
  let candidates: QlooEntity[] = [];
  try {
    candidates = await ctx.qloo.search(name, { types: ["urn:entity:artist"], take: 5, signal: ctx.signal });
  } catch (err) {
    // If the typed search is rejected (e.g. the type isn't accepted by /search), fall through to an untyped search.
    if (!(err instanceof UpstreamError) || err.retryable) throw err;
    ctx.log.warn("Typed artist search rejected; retrying untyped", { status: err.status });
  }
  ctx.usage.add("qloo", 1);
  if (candidates.length === 0) {
    const any = await ctx.qloo.search(name, { take: 5, signal: ctx.signal });
    ctx.usage.add("qloo", 1);
    candidates = any.filter((e) => e.type === "urn:entity:artist" || e.type === "urn:entity:person");
  }
  return candidates;
}

export const artistResolve: Skill<BriefInput, ArtistResolveOutput> = {
  id: "artist.resolve",
  title: "Finding the artist",
  dependsOn: [],
  timeoutMs: 20_000,
  output: artistResolveOutput,
  async run(ctx, input) {
    const name = normalizeArtistName(input.artist);

    const candidates = await findArtistCandidates(ctx, name);

    const best = pickBest(name, candidates);
    if (!best) throw new NotFoundError(`We couldn't find "${name}" in the taste data. Check the spelling or try their stage name.`);

    const properties = Object.fromEntries(KEEP_PROPS.filter((k) => best.properties[k] != null).map((k) => [k, best.properties[k]]));

    return {
      data: {
        artist: { id: best.id, name: best.name, type: best.type, image: best.image, popularity: best.popularity, properties },
        alternatives: candidates.filter((c) => c.id !== best.id).slice(0, 4).map((c) => ({ id: c.id, name: c.name, image: c.image })),
      },
      evidence: [{ source: "qloo", entityId: best.id, label: best.name, query: `search · "${name}"` }],
    };
  },
};
