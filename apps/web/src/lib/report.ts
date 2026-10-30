// Turns a mission's results into a Markdown report the user can download and share.
import type {
  ArtistResolveOutput,
  BrandMatchesOutput,
  BrandPitchesOutput,
  BrandResearchOutput,
  ContentAdsOutput,
  ContentAnglesOutput,
  ContentMerchOutput,
  ContentReleaseOutput,
  FansDemographicsOutput,
  FansDnaOutput,
  FansProfileOutput,
  GrowthCollaboratorsOutput,
  GrowthMarketsOutput,
  GrowthPressOutput,
  TourExperiencesOutput,
  TourRouteOutput,
  TourVenuesOutput,
  CompareArtistsOutput,
  CompareBrandsOutput,
  FansSegmentsOutput,
  Place,
  TripActionsOutput,
  TripAgentOutput,
  TripExecuteOutput,
  TripPlanOutput,
  TripRoutesOutput,
} from "@backline/engine";
import type { Evidence, StepResult } from "./mission-stream";
import { BRAND } from "./brand";
import { hostOf } from "./host";

const get = <T,>(r: Record<string, StepResult>, id: string) => r[id]?.data as T | undefined;

const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString("en")} ${currency}`;
  }
};
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null);
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
const mdEsc = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");

/** One place as a Markdown block: what it is, why, how far, what it costs, how to reach it. */
function placeBlock(p: Place, picked: boolean, anchor: string | null): string[] {
  const facts = [
    p.distanceKm != null ? `${p.distanceKm < 1 ? `${Math.round(p.distanceKm * 1000)} m` : `${p.distanceKm} km`}${anchor ? ` from ${anchor}` : ""}` : null,
    p.rating != null ? `rated ${p.rating.toFixed(1)}` : null,
    p.priceLevel != null ? `price level ${p.priceLevel} of 4` : null,
    p.offer ? `${money(p.offer.total, p.offer.currency)} for your dates${p.offer.refundable ? " (refundable)" : ""}` : p.priceNote,
  ].filter(Boolean);
  const contact = [p.phone ? `phone ${p.phone}` : null, p.email ? `email ${p.email}` : null, p.website ? `[website](${p.website})` : null, p.lat != null && p.lon != null ? `[map](https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon})` : null].filter(Boolean);
  return [
    `- **${mdEsc(p.name)}**${picked ? " (my pick)" : ""}${p.address ? `, ${mdEsc(p.address)}` : ""}`,
    facts.length ? `  ${facts.join(" · ")}` : "",
    p.why.length ? `  Why: ${p.why.join("; ")}` : "",
    contact.length ? `  ${contact.join(" · ")}` : "",
  ].filter(Boolean);
}

/** The planning mission as a report: understanding, picks, the plan with routes, actions, research. */
function tripReport(goal: string, results: Record<string, StepResult>): string {
  const a = get<TripAgentOutput>(results, "trip.agent")!;
  const plan = get<TripPlanOutput>(results, "trip.plan");
  const routes = get<TripRoutesOutput>(results, "trip.routes");
  const actions = get<TripActionsOutput>(results, "trip.actions");
  const exec = get<TripExecuteOutput>(results, "trip.execute");
  const t = a.trip;
  const anchor = a.where.landmark?.name ?? a.where.city?.name ?? null;
  const out: string[] = [];
  const h = (s: string) => out.push("", `## ${s}`, "");
  out.push(`# ${mdEsc(goal)}`, "", `Prepared by ${BRAND.name} on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`);

  if (a.summary) {
    h("Summary");
    out.push(a.summary);
  }
  h("Your trip");
  out.push(...[
    `- **Where:** ${a.where.city ? a.where.city.display : t.destination}`,
    t.startDate ? `- **When:** ${day(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` to ${day(t.endDate)}` : ""}` : "- **When:** dates to confirm",
    `- **Who:** ${t.adults} ${t.adults === 1 ? "person" : "people"}, ${t.rooms} room${t.rooms === 1 ? "" : "s"}`,
    t.budget.amount ? `- **Budget:** ${money(t.budget.amount, t.budget.currency)}${t.budget.scope === "per_night" ? " a night" : " in total"}` : `- **Budget:** ${t.priceTier === 1 ? "budget" : t.priceTier === 4 ? "luxury" : "mid-range"}`,
    t.near ? `- **Near:** ${a.where.landmark ? a.where.landmark.display : t.near}` : "",
    t.purpose ? `- **Purpose:** ${t.purpose}` : "",
    t.event ? `- **Hosting:** ${t.event.type}${t.event.guests ? ` for ${t.event.guests} guests` : ""}` : "",
    t.travelMode ? `- **Getting there:** ${t.travelMode}${t.selfArranged.includes("transport") ? " (you're booking it)" : ""}` : "",
  ].filter(Boolean));
  if (t.assumptions.length) out.push("", `Assumed: ${t.assumptions.join("; ")}.`);
  if (a.questions.length) out.push("", "**Only you can decide:**", ...a.questions.map((q) => `- ${q}`));

  const sectionOf = (title: string, list: Place[], picks: string[]) => {
    if (!list.length) return;
    h(title);
    for (const p of list) out.push(...placeBlock(p, picks.includes(p.id), anchor));
  };
  sectionOf("Where you'll stay", a.stays, plan?.stayId ? [plan.stayId] : a.picks.stays);
  sectionOf("Where you'll host it", a.venues, plan?.venueId ? [plan.venueId] : a.picks.venues);
  sectionOf("Where you'll eat", a.dines, a.picks.dines);
  sectionOf("Things to do", a.activities, a.picks.activities);

  if (plan) {
    const names = new Map<string, string>([...a.stays, ...a.dines, ...a.venues, ...a.activities].map((p) => [p.id, p.name]));
    for (const s of a.stops) names.set(s.id, s.name);
    h("The plan");
    if (plan.summary) out.push(plan.summary, "");
    plan.days.forEach((d, i) => {
      const r = routes?.days.find((x) => x.index === i);
      out.push(`### Day ${i + 1}: ${d.label}${d.date ? ` (${day(d.date)})` : ""}`, "");
      for (const it of d.items) out.push(`- **${it.time}** ${it.title}${it.note ? `. ${it.note}` : ""}${it.placeId && names.get(it.placeId) && !it.title.includes(names.get(it.placeId)!) ? ` (${names.get(it.placeId)})` : ""}`);
      if (r && r.legs.length) {
        out.push("", `Getting around: ${r.legs.map((l) => `${r.stops[l.from].name} to ${r.stops[l.to].name}, ${l.mode === "walk" ? "walk" : "drive"} ${mins(l.minutes)} (${l.km} km)`).join("; ")}.`);
        out.push(`About ${mins(r.minutes)} of travel, ${r.km} km${r.legs.some((l) => l.estimated) ? " (estimated)" : ""}.${r.directions ? ` [Directions](${r.directions})` : ""}`);
      }
      out.push("");
    });
    if (plan.budget.length) {
      h("Budget");
      out.push("| Item | Amount | How I estimated |", "| --- | --- | --- |");
      for (const b of plan.budget) out.push(`| ${mdEsc(b.item)} | ${b.amount != null ? money(b.amount, b.currency) : "To confirm"} | ${mdEsc(b.basis)} |`);
      const total = plan.budget.reduce((s, b) => s + (b.amount ?? 0), 0);
      const cur = plan.budget.find((b) => b.amount)?.currency;
      if (total > 0 && cur) out.push(`| **Estimated total** | **${money(total, cur)}** | Final prices are confirmed when booking |`);
    }
    if (plan.tips.length) {
      h("Tips");
      out.push(...plan.tips.map((x) => `- ${x}`));
    }
  }

  if (actions) {
    h(exec ? "What I did" : "Ready to do");
    const res = new Map((exec?.results ?? []).map((r) => [r.actionId, r]));
    for (const x of actions.actions) {
      const r = res.get(x.id);
      const how = x.channel === "link" && x.url ? ` [Open](${x.url})` : x.channel === "email" && x.to ? ` (to ${x.to})` : x.channel === "call" && x.to ? ` (${x.to})` : "";
      out.push(`- ${x.title}${how}${r ? `: ${r.message}` : ""}${r?.checkoutUrl ? ` [Pay securely to confirm](${r.checkoutUrl})` : ""}`);
    }
  }

  if (a.facts.length) {
    h("Research notes");
    for (const f of a.facts) out.push(`- ${f.text}${f.url ? ` ([${hostOf(f.url)}](${f.url}))` : ""}`);
  }

  const steps = a.log.filter((l) => l.kind === "think" || l.kind === "saw" || l.kind === "note");
  if (steps.length) {
    h("How I worked it out");
    for (const l of steps.slice(0, 40)) out.push(l.kind === "think" ? `- ${l.text}` : `  - ${l.text}${l.ok === false ? " (didn't work)" : ""}`);
  }

  const web = new Map<string, Evidence>();
  for (const r of Object.values(results)) for (const e of r.evidence) if (e.source === "web") web.set(e.url, e);
  h("Sources");
  out.push("Taste and place data from Qloo. Map data © OpenStreetMap contributors. Routes from OSRM on OpenStreetMap data.");
  for (const e of web.values()) if (e.source === "web") out.push(`- [${mdEsc(e.title)}](${e.url})`);
  return out.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export function buildReport(goal: string, results: Record<string, StepResult>): string {
  if (results["trip.agent"]) return tripReport(goal, results);
  const out: string[] = [];
  const h = (t: string) => out.push("", `## ${t}`, "");
  const artist = get<ArtistResolveOutput>(results, "artist.resolve")?.artist;
  out.push(`# ${goal}`, "", `Prepared by ${BRAND.name} on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`);

  const h2h = get<CompareBrandsOutput>(results, "compare.brands");
  if (h2h?.applicable) {
    h("Head-to-head");
    out.push(h2h.verdict);
  }
  const cmp = get<CompareArtistsOutput>(results, "compare.artists");
  if (cmp?.applicable && cmp.rival) {
    h(`Compared with ${cmp.rival.name}`);
    out.push(...cmp.takeaways.map((t) => `- ${t}`), "", `Both: ${cmp.shared.join(", ") || "none"}`, `Only ${artist?.name ?? "this artist"}: ${cmp.onlyArtist.join(", ") || "none"}`, `Only ${cmp.rival.name}: ${cmp.onlyRival.join(", ") || "none"}`);
  }
  const segs = get<FansSegmentsOutput>(results, "fans.segments");
  if (segs?.segments.some((s) => s.brands.length + s.artists.length)) {
    h("Fan segments");
    for (const s of segs.segments) out.push(`- **Ages ${s.label}**: ${[...s.artists, ...s.brands].map((e) => e.name).slice(0, 6).join(", ")}`);
  }
  const pitches = get<BrandPitchesOutput>(results, "brand.pitches");
  if (pitches?.pitches.length) {
    h("Pitches");
    for (const p of pitches.pitches) {
      out.push(`### ${p.brandName}`, "", `**Subject:** ${p.subject}`, "", p.body, "", "Based on:", ...p.facts.map((f) => `- ${f.text}`), "");
      if (p.contactRoute) out.push(`Who to contact: ${p.contactRoute}`, "");
    }
  }
  const matches = get<BrandMatchesOutput>(results, "brand.matches");
  if (matches?.matches.length) {
    h("Brand matches");
    for (const m of matches.matches) out.push(`- **${m.name}** (fit ${Math.round(m.fit * 100)}${m.alreadyPartnered ? ", already partnered" : ""}): ${m.reasons.join(" ")}`);
  }
  const research = get<BrandResearchOutput>(results, "brand.research");
  if (research?.enabled && research.brands.some((b) => b.findings.length)) {
    h("Brand research");
    for (const b of research.brands.filter((x) => x.findings.length)) {
      out.push(`### ${b.name}`, ...b.findings.map((f) => `- ${f.text} ([source](${f.url}))`), b.angle ? `\nWhy now: ${b.angle}` : "", "");
    }
  }
  const route = get<TourRouteOutput>(results, "tour.route");
  if (route?.legs.length) {
    h("Tour route");
    out.push(`About ${route.totalKm.toLocaleString("en")} km in total (straight-line).`, "");
    for (const l of route.legs) out.push(`${l.order}. **${l.city}**${l.headliner ? ` at ${l.headliner}` : ""}${l.kmFromPrevious ? ` (${l.kmFromPrevious.toLocaleString("en")} km)` : ""}`);
  }
  const venues = get<TourVenuesOutput>(results, "tour.venues");
  if (venues?.stops.length) {
    h("Venues");
    for (const s of venues.stops) out.push(`**${s.city}**${s.coverage !== "exact" ? ` (searched ${s.searched})` : ""}`, ...(s.venues.length ? s.venues.map((v) => `- ${v.name}${v.address ? `, ${v.address}` : ""}`) : ["- No venue data yet"]), "");
  }
  const exp = get<TourExperiencesOutput>(results, "tour.experiences");
  if (exp?.ideas.length) {
    h("Fan experiences");
    for (const i of exp.ideas) out.push(`- **${i.title}**${i.city ? ` (${i.city})` : ""}: ${i.description}`);
  }
  const collabs = get<GrowthCollaboratorsOutput>(results, "growth.collaborators");
  if (collabs?.collaborators.length) {
    h("Collaborators");
    for (const c of collabs.collaborators) out.push(`- **${c.name}** (${c.tier}): ${c.reason}`);
  }
  const markets = get<GrowthMarketsOutput>(results, "growth.markets");
  if (markets?.markets.length) {
    h("New markets");
    out.push(markets.markets.map((m) => m.name).join(", "));
  }
  const press = get<GrowthPressOutput>(results, "growth.press");
  if (press && (press.podcasts.length || press.outlets.length)) {
    h("Press and podcasts");
    if (press.podcasts.length) out.push(`Podcasts the fans love: ${press.podcasts.map((p) => p.name).join(", ")}`, "");
    for (const o of press.outlets) out.push(`- **${o.domain}**, recently covered ${o.covered.join(", ")}`);
  }
  const angles = get<ContentAnglesOutput>(results, "content.angles");
  if (angles?.angles.length) {
    h("Content angles");
    for (const a of angles.angles) out.push(`- **${a.title}** (${a.format}). Hook: "${a.hook}". ${a.why}`);
  }
  const ads = get<ContentAdsOutput>(results, "content.ads");
  if (ads) {
    h("Ad targeting");
    out.push(ads.summary, "");
    if (ads.ages.length) out.push(`- Ages: ${ads.ages.map((a) => a.label).join(", ")}`);
    if (ads.gender) out.push(`- Gender: ${ads.gender}`);
    for (const i of ads.interests) out.push(`- ${i.group}: ${i.names.join(", ")}`);
    if (ads.locations.length) out.push(`- Locations: ${ads.locations.join(", ")}`);
    if (ads.keywords.length) out.push(`- Keywords: ${ads.keywords.join(", ")}`);
  }
  const merch = get<ContentMerchOutput>(results, "content.merch");
  if (merch?.ideas.length) {
    h("Merch direction");
    for (const m of merch.ideas) out.push(`- **${m.item}**: ${m.concept} ${m.why}`);
  }
  const release = get<ContentReleaseOutput>(results, "content.release");
  if (release?.weeks.length) {
    h(release.title);
    for (const w of release.weeks) out.push(`**${w.label}**: ${w.focus}`, ...w.actions.map((a) => `- ${a}`), "");
  }
  const dna = get<FansDnaOutput>(results, "fans.dna");
  if (dna?.themes.length) {
    h(`Fan DNA${artist ? `: ${artist.name}` : ""}`);
    for (const t of dna.themes) out.push(`- **${t.name}** (${Math.round(t.strength * 100)}): ${t.description}`);
  }
  const demo = get<FansDemographicsOutput>(results, "fans.demographics");
  if (demo?.available) {
    h("Who the fans are");
    out.push(`Strongest age group: ${demo.strongestAge ?? "n/a"}. Gender: ${demo.gender.lean ?? "n/a"}${demo.gender.strength ? ` (${demo.gender.strength})` : ""}.`);
  }
  const profile = get<FansProfileOutput>(results, "fans.profile");
  if (profile) {
    h("What the fans love");
    for (const c of profile.categories.filter((x) => x.items.length)) out.push(`- ${c.label}: ${c.items.slice(0, 6).map((i) => i.name).join(", ")}`);
  }

  const web = new Map<string, Evidence>();
  for (const r of Object.values(results)) for (const e of r.evidence) if (e.source === "web") web.set(e.url, e);
  h("Sources");
  out.push("Taste data from Qloo.");
  for (const e of web.values()) if (e.source === "web") out.push(`- [${e.title}](${e.url})`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
