import { z } from "zod";
import type { BriefInput, Evidence, Skill } from "../types";
import type { WebResult } from "../clients/web";
import { UNTRUSTED_WEB_RULE, languageRule, quoteWeb, webEvidence } from "../grounding";
import { mapLimit } from "../util";
import type { BrandMatchesOutput } from "./brand-matches";

const RESEARCH_MAX = 5;

export const brandResearchOutput = z.object({
  enabled: z.boolean(),
  brands: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      findings: z.array(z.object({ text: z.string(), url: z.string(), title: z.string() })),
      angle: z.string().nullable(),
      contactRoute: z.string().nullable(),
    })
  ),
});
export type BrandResearchOutput = z.infer<typeof brandResearchOutput>;

const modelSchema = z.object({
  findings: z.array(z.object({ text: z.string(), source: z.string() })).max(6),
  angle: z.string().nullable().optional(),
  contactRoute: z.string().nullable().optional(),
});

/** Brands worth researching: the strongest new (not already partnered) matches, plus any the user picked. */
export function researchTargets(matches: BrandMatchesOutput["matches"], selected: string[] = []): BrandMatchesOutput["matches"] {
  const picked = matches.filter((m) => selected.includes(m.id));
  const rest = matches.filter((m) => !m.alreadyPartnered && !selected.includes(m.id));
  return [...picked, ...rest].slice(0, Math.max(RESEARCH_MAX, picked.length));
}

export const brandResearch: Skill<BriefInput, BrandResearchOutput> = {
  id: "brand.research",
  title: "Researching each brand's recent moves",
  dependsOn: ["brand.matches"],
  timeoutMs: 75_000,
  output: brandResearchOutput,
  async run(ctx, input, deps) {
    const { matches } = deps["brand.matches"].data as BrandMatchesOutput;
    if (!ctx.web) {
      return { data: { enabled: false, brands: [] }, evidence: [], notes: ["Live web research is off (no search key configured), so pitches use taste data only."] };
    }
    const targets = researchTargets(matches, input.selections?.brands);
    const evidence: Evidence[] = [];
    const year = new Date().getFullYear();

    const brands = await mapLimit(targets, 3, async (b) => {
      let results: WebResult[] = [];
      try {
        results = await ctx.web!.search(`${b.name} brand partnership with musician campaign ${year}`, { maxResults: 5, signal: ctx.signal });
        ctx.usage.add("web", 1);
      } catch (err) {
        ctx.log.warn("Brand web search failed", { brand: b.name, error: String(err) });
        return { id: b.id, name: b.name, findings: [], angle: null, contactRoute: null };
      }
      if (results.length === 0) return { id: b.id, name: b.name, findings: [], angle: null, contactRoute: null };
      const byId = new Map(results.map((r, i) => [`w${i + 1}`, r]));

      let findings: { text: string; url: string; title: string }[] = [];
      let angle: string | null = null;
      let contactRoute: string | null = null;
      if (ctx.llm) {
        try {
          const out = await ctx.llm.json({
            tier: "fast",
            schema: modelSchema,
            maxTokens: 900,
            temperature: 0.2,
            signal: ctx.signal,
            system: [
              "You research brands for a music manager preparing a partnership pitch.",
              UNTRUSTED_WEB_RULE,
              "Summarise up to 5 recent, concrete facts about the brand that matter for a music partnership (campaigns, music or culture collaborations, launches, markets entered). Each fact cites one source id (w1, w2, …). Skip anything not about this brand.",
              "angle: one sentence on why this brand might want a music partner now, based only on the findings, or null.",
              "contactRoute: who usually handles partnerships at this brand if a source says so (team or agency name), otherwise null. Never guess emails or people.",
              languageRule(input),
              'Shape: {"findings":[{"text":"…","source":"w1"}],"angle":"…"|null,"contactRoute":"…"|null}',
            ].join("\n"),
            user: `Brand: ${b.name}\n\n${quoteWeb(results)}`,
          });
          findings = out.findings
            .filter((f) => byId.has(f.source) && f.text.trim())
            .map((f) => ({ text: f.text.trim().slice(0, 240), url: byId.get(f.source)!.url, title: byId.get(f.source)!.title }));
          angle = findings.length > 0 ? out.angle?.trim().slice(0, 240) || null : null;
          contactRoute = out.contactRoute?.trim().slice(0, 160) || null;
        } catch (err) {
          ctx.log.warn("Brand research summary failed; using headlines", { brand: b.name, error: String(err) });
        }
      }
      if (findings.length === 0) findings = results.slice(0, 3).map((r) => ({ text: r.title, url: r.url, title: r.title }));
      const used = new Set(findings.map((f) => f.url));
      for (const r of results) if (used.has(r.url)) evidence.push(webEvidence(r));
      return { id: b.id, name: b.name, findings, angle, contactRoute };
    });

    return { data: { enabled: true, brands }, evidence };
  },
};
