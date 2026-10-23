import { z } from "zod";
import type { BriefInput, Evidence, Skill } from "../types";
import { FactSheet, GROUNDING_RULES, artistFrom, languageRule } from "../grounding";
import type { FansDnaOutput } from "./fans-dna";
import type { FansProfileOutput } from "./fans-profile";
import type { FansDemographicsOutput } from "./fans-demographics";
import type { TourCitiesOutput } from "./tour";
import type { GrowthMarketsOutput } from "./growth";

const FORMATS = ["Short video", "Carousel", "Live", "Long video", "Newsletter", "Collab post", "Behind the scenes"] as const;
const factsOut = z.array(z.object({ id: z.string(), text: z.string() }));

/** Shared fact sheet: fan themes and the crossover tastes worth building content around. */
function tasteFacts(artistName: string, artistId: string, dna?: FansDnaOutput, profile?: FansProfileOutput, demo?: FansDemographicsOutput): FactSheet {
  const facts = new FactSheet();
  for (const t of (dna?.themes ?? []).slice(0, 8)) facts.add(`Fan theme "${t.name}": ${t.description}`, { source: "derived", label: t.name, basis: `fan DNA of ${artistName}` });
  for (const cat of profile?.categories ?? []) {
    for (const it of cat.items.slice(0, 4)) facts.add(`Fans also love (${cat.label.toLowerCase()}): ${it.name}`, { source: "qloo", entityId: it.id, label: it.name, affinity: it.affinity ?? undefined, query: `${cat.label.toLowerCase()} · fans of ${artistName}` });
  }
  if (demo?.available && demo.strongestAge) facts.add(`Strongest fan age group: ${demo.strongestAge}.`, { source: "qloo", entityId: artistId, label: `Audience of ${artistName}`, query: "demographics" });
  return facts;
}

const deps = (d: Record<string, { data: unknown } | undefined>) => ({
  dna: d["fans.dna"]?.data as FansDnaOutput | undefined,
  profile: d["fans.profile"]?.data as FansProfileOutput | undefined,
  demo: d["fans.demographics"]?.data as FansDemographicsOutput | undefined,
});

// ---------- content.angles ----------

export const contentAnglesOutput = z.object({
  angles: z.array(z.object({ title: z.string(), format: z.string(), hook: z.string(), why: z.string(), sources: z.array(z.string()) })),
  facts: factsOut,
  method: z.enum(["model", "template"]),
});
export type ContentAnglesOutput = z.infer<typeof contentAnglesOutput>;

const anglesModel = z.object({
  angles: z.array(z.object({ title: z.string(), format: z.string(), hook: z.string(), why: z.string(), sources: z.array(z.string()) })).min(1),
});

export const contentAngles: Skill<BriefInput, ContentAnglesOutput> = {
  id: "content.angles",
  title: "Finding content angles",
  dependsOn: ["artist.resolve", "fans.dna"],
  optionalDeps: ["fans.profile", "fans.demographics"],
  timeoutMs: 75_000,
  output: contentAnglesOutput,
  async run(ctx, input, d) {
    const artist = artistFrom(d);
    const { dna, profile, demo } = deps(d);
    const facts = tasteFacts(artist.name, artist.id, dna, profile, demo);

    if (ctx.llm && facts.size > 0) {
      try {
        const out = await ctx.llm.json({
          tier: "default",
          schema: anglesModel,
          maxTokens: 2400,
          temperature: 0.8,
          signal: ctx.signal,
          system: [
            "You are a music content strategist. Propose content ideas that connect an artist to what their fans already love, so posts feel made for them.",
            GROUNDING_RULES,
            `Return 6 ideas. format is one of: ${FORMATS.join(", ")}. hook is the first line or first 2 seconds, written out. why is one sentence tying it to the facts.`,
            input.focus ? `The ideas should support: ${input.focus.slice(0, 120)}.` : "",
            languageRule(input),
            'Shape: {"angles":[{"title":"…","format":"Short video","hook":"…","why":"…","sources":["f1","f4"]}]}',
          ].join("\n"),
          user: `Artist: ${artist.name}\n\nFacts:\n${facts.render()}`,
        });
        const angles = out.angles
          .map((a) => ({
            title: a.title.trim().slice(0, 90),
            format: (FORMATS as readonly string[]).includes(a.format) ? a.format : "Short video",
            hook: a.hook.trim().slice(0, 240),
            why: a.why.trim().slice(0, 300),
            sources: facts.keep(a.sources),
          }))
          .filter((a) => a.sources.length > 0)
          .slice(0, 8);
        if (angles.length >= 3) {
          const used = [...new Set(angles.flatMap((a) => a.sources))];
          return { data: { angles, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "model" }, evidence: facts.evidenceFor(used) };
        }
      } catch (err) {
        ctx.log.warn("Content angles failed; using template", { error: String(err) });
      }
    }

    const themes = facts.all().filter((f) => f.text.startsWith("Fan theme"));
    const loves = facts.all().filter((f) => f.text.startsWith("Fans also love"));
    const angles = themes.slice(0, 6).map((t, i) => {
      const name = t.text.match(/"([^"]+)"/)?.[1] ?? "Fan favourite";
      const l = loves[i];
      const item = l ? l.text.replace(/^Fans also love \([^)]+\): /, "") : null;
      return {
        title: item ? `${name} × ${item}` : name,
        format: FORMATS[i % FORMATS.length],
        hook: item ? `If you love ${item}, this one's for you.` : `This one's for the ${name.toLowerCase()} crowd.`,
        why: `Built on the fanbase's "${name}" theme${item ? ` and their love of ${item}` : ""}.`,
        sources: l ? [t.id, l.id] : [t.id],
      };
    });
    const used = [...new Set(angles.flatMap((a) => a.sources))];
    return { data: { angles, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "template" }, evidence: facts.evidenceFor(used) };
  },
};

// ---------- content.ads ----------

export const contentAdsOutput = z.object({
  ages: z.array(z.object({ label: z.string(), index: z.number() })),
  gender: z.string().nullable(),
  interests: z.array(z.object({ group: z.string(), names: z.array(z.string()) })),
  locations: z.array(z.string()),
  keywords: z.array(z.string()),
  summary: z.string(),
});
export type ContentAdsOutput = z.infer<typeof contentAdsOutput>;

/** Assemble an ad-targeting brief from what's known. Pure and fully grounded: no model. */
export function buildAdBrief(
  artistName: string,
  p: { demo?: FansDemographicsOutput; profile?: FansProfileOutput; dna?: FansDnaOutput; cities?: TourCitiesOutput; markets?: GrowthMarketsOutput }
): ContentAdsOutput {
  const ages = (p.demo?.ages ?? []).filter((a) => a.index > 0).sort((a, b) => b.index - a.index).map((a) => ({ label: a.label, index: Math.round(a.index * 100) / 100 }));
  const g = p.demo?.gender;
  const gender = !g?.lean ? null : g.lean === "balanced" ? "All genders (the fanbase is balanced)" : `Leans ${g.lean}${g.strength ? ` (${g.strength})` : ""}`;
  const groups: [string, string][] = [["artists", "Similar artists"], ["brands", "Brands"], ["tv", "TV"], ["movies", "Films"], ["podcasts", "Podcasts"]];
  const interests = groups
    .map(([key, group]) => ({ group, names: (p.profile?.categories.find((c) => c.key === key)?.items ?? []).slice(0, 6).map((i) => i.name) }))
    .filter((x) => x.names.length > 0);
  const locations = [...(p.cities?.cities ?? []).map((c) => c.name), ...(p.markets?.markets ?? []).map((m) => m.name)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
  const keywords = (p.dna?.themes ?? []).slice(0, 8).map((t) => t.name);
  const parts = [
    ages.length ? `ages ${ages.slice(0, 2).map((a) => a.label).join(" and ")}` : null,
    interests[0] ? `people into ${interests[0].names.slice(0, 3).join(", ")}` : null,
    locations.length ? `in ${locations.slice(0, 3).join(", ")}` : null,
  ].filter(Boolean);
  const summary = parts.length ? `Target ${parts.join(", ")} to reach ${artistName}'s likely fans.` : `Not enough audience data to target ${artistName}'s fans yet.`;
  return { ages, gender, interests, locations, keywords, summary };
}

export const contentAds: Skill<BriefInput, ContentAdsOutput> = {
  id: "content.ads",
  title: "Building the ad-targeting brief",
  dependsOn: ["artist.resolve"],
  optionalDeps: ["fans.demographics", "fans.profile", "fans.dna", "tour.cities", "growth.markets"],
  timeoutMs: 5_000,
  output: contentAdsOutput,
  async run(_ctx, _input, d) {
    const artist = artistFrom(d);
    const { dna, profile, demo } = deps(d);
    const brief = buildAdBrief(artist.name, {
      demo,
      profile,
      dna,
      cities: d["tour.cities"]?.data as TourCitiesOutput | undefined,
      markets: d["growth.markets"]?.data as GrowthMarketsOutput | undefined,
    });
    const evidence: Evidence[] = [{ source: "derived", label: "Ad-targeting brief", basis: "Assembled from Qloo demographics, taste profile and locations above" }];
    return { data: brief, evidence, notes: ["Use these as interest and lookalike seeds in Meta, TikTok or Google ads. Platforms' interest names vary, so match the closest."] };
  },
};

// ---------- content.merch ----------

export const contentMerchOutput = z.object({
  ideas: z.array(z.object({ item: z.string(), concept: z.string(), why: z.string(), sources: z.array(z.string()) })),
  facts: factsOut,
  method: z.enum(["model", "template"]),
});
export type ContentMerchOutput = z.infer<typeof contentMerchOutput>;

const merchModel = z.object({ ideas: z.array(z.object({ item: z.string(), concept: z.string(), why: z.string(), sources: z.array(z.string()) })).min(1) });

export const contentMerch: Skill<BriefInput, ContentMerchOutput> = {
  id: "content.merch",
  title: "Sketching merch direction",
  dependsOn: ["artist.resolve", "fans.dna"],
  optionalDeps: ["fans.profile", "fans.demographics"],
  timeoutMs: 60_000,
  output: contentMerchOutput,
  async run(ctx, input, d) {
    const artist = artistFrom(d);
    const { dna, profile, demo } = deps(d);
    const facts = tasteFacts(artist.name, artist.id, dna, profile, demo);
    if (ctx.llm && facts.size > 0) {
      try {
        const out = await ctx.llm.json({
          tier: "fast",
          schema: merchModel,
          maxTokens: 1000,
          temperature: 0.8,
          signal: ctx.signal,
          system: [
            "You are a merch director for music artists. Propose merch that this specific fanbase would actually wear or use, inspired by their tastes. Never copy another brand's logos or trademarks; collaborations are proposals only.",
            GROUNDING_RULES,
            "Return 5 ideas. item: the product (e.g. 'heavyweight tee', 'tote', 'bucket hat'). concept: the design idea in one sentence. why: one sentence tied to the facts.",
            languageRule(input),
            'Shape: {"ideas":[{"item":"…","concept":"…","why":"…","sources":["f2"]}]}',
          ].join("\n"),
          user: `Artist: ${artist.name}\n\nFacts:\n${facts.render()}`,
        });
        const ideas = out.ideas
          .map((i) => ({ item: i.item.trim().slice(0, 60), concept: i.concept.trim().slice(0, 240), why: i.why.trim().slice(0, 240), sources: facts.keep(i.sources) }))
          .filter((i) => i.sources.length > 0)
          .slice(0, 6);
        if (ideas.length >= 2) {
          const used = [...new Set(ideas.flatMap((i) => i.sources))];
          return { data: { ideas, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "model" }, evidence: facts.evidenceFor(used) };
        }
      } catch (err) {
        ctx.log.warn("Merch ideas failed; using template", { error: String(err) });
      }
    }
    const items = ["Heavyweight tee", "Tote bag", "Cap", "Poster", "Hoodie"];
    const themes = facts.all().filter((f) => f.text.startsWith("Fan theme")).slice(0, 5);
    const ideas = themes.map((t, i) => {
      const name = t.text.match(/"([^"]+)"/)?.[1] ?? "Fan";
      return { item: items[i], concept: `A design built around "${name}".`, why: `The fanbase's "${name}" theme.`, sources: [t.id] };
    });
    const used = ideas.flatMap((i) => i.sources);
    return { data: { ideas, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "template" }, evidence: facts.evidenceFor(used) };
  },
};

// ---------- content.release ----------

export const contentReleaseOutput = z.object({
  title: z.string(),
  weeks: z.array(z.object({ label: z.string(), focus: z.string(), actions: z.array(z.string()), sources: z.array(z.string()) })),
  facts: factsOut,
  method: z.enum(["model", "template"]),
});
export type ContentReleaseOutput = z.infer<typeof contentReleaseOutput>;

const releaseModel = z.object({
  weeks: z.array(z.object({ label: z.string(), focus: z.string(), actions: z.array(z.string()).min(1), sources: z.array(z.string()) })).min(3),
});

export const WEEK_LABELS = ["4 weeks before", "3 weeks before", "2 weeks before", "Release week", "1 week after", "2 weeks after"];

export const contentRelease: Skill<BriefInput, ContentReleaseOutput> = {
  id: "content.release",
  title: "Planning the release campaign",
  dependsOn: ["artist.resolve", "content.angles"],
  optionalDeps: ["content.ads", "tour.cities", "brand.matches", "growth.collaborators"],
  timeoutMs: 90_000,
  output: contentReleaseOutput,
  async run(ctx, input, d) {
    const artist = artistFrom(d);
    const angles = d["content.angles"].data as ContentAnglesOutput;
    const ads = d["content.ads"]?.data as ContentAdsOutput | undefined;
    const cities = d["tour.cities"]?.data as TourCitiesOutput | undefined;
    const brands = d["brand.matches"]?.data as { matches: { id: string; name: string; alreadyPartnered: boolean }[] } | undefined;
    const collabs = d["growth.collaborators"]?.data as { collaborators: { id: string; name: string }[] } | undefined;
    const title = input.focus ? `Release plan: ${input.focus.slice(0, 80)}` : `Release plan for ${artist.name}'s next single`;

    const facts = new FactSheet();
    for (const a of angles.angles) facts.add(`Content angle (${a.format}): ${a.title}. Hook: ${a.hook}`, { source: "derived", label: a.title, basis: "content angles" });
    if (ads) facts.add(`Ad targeting: ${ads.summary}`, { source: "derived", label: "Ad brief", basis: "ad-targeting brief" });
    for (const c of (cities?.cities ?? []).slice(0, 4)) facts.add(`Strong city for this fanbase: ${c.name}`, { source: "qloo", entityId: c.id, label: c.name, query: `destinations · fans of ${artist.name}` });
    for (const b of (brands?.matches ?? []).filter((m) => !m.alreadyPartnered).slice(0, 3)) facts.add(`Brand the fans love: ${b.name}`, { source: "qloo", entityId: b.id, label: b.name, query: `brands · fans of ${artist.name}` });
    for (const c of (collabs?.collaborators ?? []).slice(0, 3)) facts.add(`Artist who shares the fans: ${c.name}`, { source: "qloo", entityId: c.id, label: c.name, query: `artists · fans of ${artist.name}` });

    if (ctx.llm) {
      try {
        const out = await ctx.llm.json({
          tier: "default",
          schema: releaseModel,
          maxTokens: 2600,
          temperature: 0.6,
          signal: ctx.signal,
          system: [
            "You are a release campaign manager for an independent artist team. Plan a six-week release campaign a small team can actually run.",
            GROUNDING_RULES,
            `Return exactly six weeks labelled: ${WEEK_LABELS.join(" | ")}. Each week: a focus (one short sentence) and 2-4 concrete actions, citing fact ids.`,
            languageRule(input),
            'Shape: {"weeks":[{"label":"4 weeks before","focus":"…","actions":["…"],"sources":["f1"]}]}',
          ].join("\n"),
          user: `Artist: ${artist.name}\n${input.focus ? `Release: ${input.focus.slice(0, 120)}\n` : ""}\nFacts:\n${facts.render()}`,
        });
        const weeks = out.weeks
          .slice(0, 6)
          .map((w, i) => ({ label: WEEK_LABELS[i] ?? w.label.slice(0, 40), focus: w.focus.trim().slice(0, 200), actions: w.actions.map((a) => a.trim().slice(0, 240)).filter(Boolean).slice(0, 5), sources: facts.keep(w.sources) }));
        if (weeks.length >= 4 && weeks.filter((w) => w.sources.length > 0).length >= 3) {
          const used = [...new Set(weeks.flatMap((w) => w.sources))];
          return { data: { title, weeks, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "model" }, evidence: facts.evidenceFor(used) };
        }
      } catch (err) {
        ctx.log.warn("Release plan failed; using template", { error: String(err) });
      }
    }

    const a = facts.all().filter((f) => f.text.startsWith("Content angle"));
    const pick = (i: number) => a[i % Math.max(1, a.length)];
    const city = facts.all().find((f) => f.text.startsWith("Strong city"));
    const adsF = facts.all().find((f) => f.text.startsWith("Ad targeting"));
    const brand = facts.all().find((f) => f.text.startsWith("Brand the fans"));
    const plan: { focus: string; actions: string[]; f: (typeof a)[number] | undefined }[] = [
      { focus: "Set up and tease", actions: ["Lock the release date and pre-save link.", "Post the first teaser built on the angle below."], f: pick(0) },
      { focus: "Build anticipation", actions: ["Share a behind-the-scenes clip.", "Pitch the song to playlist curators and press."], f: pick(1) },
      { focus: "Warm up paid reach", actions: ["Start a small ad test with the targeting brief.", "Line up a collaboration post."], f: adsF ?? pick(2) },
      { focus: "Launch", actions: ["Release day post and story push.", "Go live or host a listening moment."], f: city ?? pick(3) },
      { focus: "Keep momentum", actions: ["Repost fan reactions.", "Scale the best-performing ad."], f: pick(4) },
      { focus: "Extend", actions: ["Release an alternate version or visualiser.", "Follow up on brand conversations."], f: brand ?? pick(5) },
    ];
    const weeks = plan.map((p, i) => ({ label: WEEK_LABELS[i], focus: p.focus, actions: p.f ? [...p.actions, p.f.text] : p.actions, sources: p.f ? [p.f.id] : [] }));
    const used = [...new Set(weeks.flatMap((w) => w.sources))];
    return { data: { title, weeks, facts: facts.get(used).map(({ id, text }) => ({ id, text })), method: "template" }, evidence: facts.evidenceFor(used) };
  },
};
