// "Know before you go": everything a traveller needs besides the places themselves. Hard facts come
// from free public data (weather, exchange rate, public holidays, time zone); the rest (entry rules,
// safety, health, culture, connectivity, emergency numbers, useful phrases, local guides) comes from
// web research read by the model, and every line says where it came from or that it's unverified.
// Qloo stays at the centre: the tips that follow from the person's taste are built from the taste
// profile, not from the web.
import { z } from "zod";
import type { BriefInput, Evidence, Skill, SkillContext } from "../types";
import { UNTRUSTED_WEB_RULE, languageRule, quoteWeb, webEvidence } from "../grounding";
import type { WebResult } from "../clients/web";
import type { TasteOutput } from "./taste";
import { agentOf, tripDates } from "./trip";
import { withTimeout } from "../util";

// ---------- shapes ----------

const dayWeatherSchema = z.object({
  date: z.string(),
  tmax: z.number().nullable(),
  tmin: z.number().nullable(),
  /** 0–100 */
  rainChance: z.number().nullable(),
  rainMm: z.number().nullable(),
  code: z.number().nullable(),
  label: z.string(),
  sunrise: z.string().nullable(),
  sunset: z.string().nullable(),
});
export type DayWeather = z.infer<typeof dayWeatherSchema>;

export const SECTION_IDS = ["entry", "safety", "health", "culture", "connect", "transport", "food"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_TITLES: Record<SectionId, string> = {
  entry: "Getting in",
  safety: "Staying safe",
  health: "Health",
  culture: "Customs and etiquette",
  connect: "Phone, power and internet",
  transport: "Getting around",
  food: "Eating and drinking",
};

const itemSchema = z.object({
  text: z.string(),
  /** The page this came from; null when it's general knowledge the person should double-check. */
  url: z.string().nullable(),
  site: z.string().nullable(),
  verified: z.boolean(),
});

const intelOutput = z.object({
  place: z.object({ city: z.string(), country: z.string().nullable(), countryCode: z.string().nullable(), lat: z.number().nullable(), lon: z.number().nullable() }),
  time: z.object({ zone: z.string().nullable(), utcOffsetHours: z.number().nullable() }),
  weather: z.object({
    basis: z.enum(["forecast", "history", "none"]),
    days: z.array(dayWeatherSchema),
    summary: z.string().nullable(),
    packing: z.array(z.string()),
  }),
  money: z.object({
    local: z.string().nullable(),
    home: z.string().nullable(),
    /** How many units of the local currency one unit of the home currency buys. */
    rate: z.number().nullable(),
    asOf: z.string().nullable(),
    examples: z.array(z.object({ home: z.number(), local: z.number() })),
  }),
  holidays: z.array(z.object({ date: z.string(), name: z.string(), local: z.string().nullable() })),
  sections: z.array(z.object({ id: z.enum(SECTION_IDS), title: z.string(), items: z.array(itemSchema) })),
  emergency: z.object({ police: z.string().nullable(), ambulance: z.string().nullable(), fire: z.string().nullable(), general: z.string().nullable(), verified: z.boolean() }).nullable(),
  phrases: z.array(z.object({ say: z.string(), means: z.string() })),
  guides: z.array(z.object({ name: z.string(), kind: z.string(), why: z.string(), url: z.string(), site: z.string() })),
  /** What follows from the person's Qloo taste profile. */
  tasteTips: z.array(z.object({ because: z.string(), tip: z.string() })),
  /** What couldn't be found, so the page can say so rather than leave a blank. */
  gaps: z.array(z.string()),
});
export type TripIntelOutput = z.infer<typeof intelOutput>;

// ---------- small pure helpers (tested) ----------

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const clean = (s: unknown, max: number) => (typeof s === "string" ? clip(s.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim(), max) : "");
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
};
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The local currency of a country (ISO 3166 alpha-2), for the countries travellers visit most. Pure. */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", EG: "EGP", MA: "MAD", TN: "TND", DZ: "DZD", ET: "ETB", TZ: "TZS", UG: "UGX", RW: "RWF", SN: "XOF", CI: "XOF", CM: "XAF", NA: "NAD", BW: "BWP", MU: "MUR", SC: "SCR", ZM: "ZMW", ZW: "USD", MZ: "MZN", AO: "AOA",
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", UY: "UYU", CR: "CRC", PA: "USD", DO: "DOP", JM: "JMD", CU: "CUP", BS: "BSD", BB: "BBD", TT: "TTD",
  GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", PT: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", LU: "EUR", AT: "EUR", FI: "EUR", GR: "EUR", MT: "EUR", CY: "EUR", SK: "EUR", SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", HR: "EUR",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", IS: "ISK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", RS: "RSD", UA: "UAH", RU: "RUB", TR: "TRY", GE: "GEL", AM: "AMD", AL: "ALL", BA: "BAM", ME: "EUR", MK: "MKD",
  AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR", JO: "JOD", LB: "LBP", IL: "ILS", IR: "IRR", IQ: "IQD",
  IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", MV: "MVR", TH: "THB", VN: "VND", KH: "KHR", LA: "LAK", MM: "MMK", MY: "MYR", SG: "SGD", ID: "IDR", PH: "PHP", CN: "CNY", HK: "HKD", MO: "MOP", TW: "TWD", JP: "JPY", KR: "KRW", MN: "MNT", KZ: "KZT", UZ: "UZS",
  AU: "AUD", NZ: "NZD", FJ: "FJD", PF: "XPF",
};
export const countryCurrency = (cc: string | null | undefined): string | null => (cc ? (CURRENCY_BY_COUNTRY[cc.toUpperCase()] ?? null) : null);

/** WMO weather code to words. Pure. */
export function weatherLabel(code: number | null | undefined): string {
  if (code == null) return "Unknown";
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly sunny";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Mixed";
}

/** The same calendar day n years earlier (Feb 29 becomes Feb 28). Pure. */
export function shiftYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Daily = {
  time?: string[];
  weather_code?: (number | null)[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  precipitation_probability_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
  sunrise?: (string | null)[];
  sunset?: (string | null)[];
};

const clockOf = (iso: string | null | undefined) => (iso && /T(\d{2}:\d{2})/.test(iso) ? iso.replace(/^.*T(\d{2}:\d{2}).*$/, "$1") : null);
const num = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** One forecast response as trip days. Pure. */
export function daysFromForecast(d: Daily | undefined): DayWeather[] {
  if (!d?.time) return [];
  return d.time.map((date, i) => {
    const code = num(d.weather_code?.[i]);
    const mm = num(d.precipitation_sum?.[i]);
    return {
      date,
      tmax: num(d.temperature_2m_max?.[i]) != null ? Math.round(d.temperature_2m_max![i]!) : null,
      tmin: num(d.temperature_2m_min?.[i]) != null ? Math.round(d.temperature_2m_min![i]!) : null,
      rainChance: num(d.precipitation_probability_max?.[i]) ?? (mm != null ? (mm >= 1 ? 60 : 10) : null),
      rainMm: mm != null ? round1(mm) : null,
      code,
      label: weatherLabel(code),
      sunrise: clockOf(d.sunrise?.[i]),
      sunset: clockOf(d.sunset?.[i]),
    };
  });
}

/** Past years of the same dates, averaged into what to expect. Pure. */
export function daysFromHistory(dates: string[], years: Daily[]): DayWeather[] {
  return dates.map((date, i) => {
    const pick = (f: (d: Daily) => (number | null)[] | undefined) => years.map((y) => num(f(y)?.[i])).filter((v): v is number => v != null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const rain = pick((d) => d.precipitation_sum);
    const codes = pick((d) => d.weather_code);
    const mode = codes.length ? [...codes].sort((a, b) => codes.filter((c) => c === b).length - codes.filter((c) => c === a).length)[0] : null;
    const tmax = avg(pick((d) => d.temperature_2m_max));
    const tmin = avg(pick((d) => d.temperature_2m_min));
    const mm = avg(rain);
    return {
      date,
      tmax: tmax != null ? Math.round(tmax) : null,
      tmin: tmin != null ? Math.round(tmin) : null,
      rainChance: rain.length ? Math.round((rain.filter((r) => r >= 1).length / rain.length) * 100) : null,
      rainMm: mm != null ? round1(mm) : null,
      code: mode,
      label: weatherLabel(mode),
      sunrise: clockOf(years[0]?.sunrise?.[i]),
      sunset: clockOf(years[0]?.sunset?.[i]),
    };
  });
}

/** What to pack and wear, from the forecast. Pure. */
export function packingFrom(days: DayWeather[]): string[] {
  const out: string[] = [];
  const hi = Math.max(...days.map((d) => d.tmax ?? -99));
  const lo = Math.min(...days.map((d) => d.tmin ?? 99));
  const wet = days.filter((d) => (d.rainChance ?? 0) >= 40 || (d.rainMm ?? 0) >= 3).length;
  if (!days.length) return out;
  if (wet) out.push("A light rain jacket or a compact umbrella");
  if (hi >= 30) out.push("Light, breathable clothes, sunscreen and a hat");
  if (hi <= 14) out.push("Warm layers and a coat");
  if (lo <= 4) out.push("Gloves and a warm hat for mornings and evenings");
  if (hi < 99 && lo > -99 && hi - lo >= 10 && hi > 14) out.push("Layers: midday and night differ by 10° or more");
  out.push("Comfortable walking shoes");
  return out.slice(0, 5);
}

export function weatherSummary(days: DayWeather[], basis: "forecast" | "history"): string | null {
  const hi = days.map((d) => d.tmax).filter((v): v is number => v != null);
  const lo = days.map((d) => d.tmin).filter((v): v is number => v != null);
  if (!hi.length) return null;
  const wet = days.filter((d) => (d.rainChance ?? 0) >= 40).length;
  const rain = wet === 0 ? "rain unlikely" : wet === days.length ? "rain likely every day" : `rain likely on ${wet} of ${days.length} days`;
  return `${basis === "history" ? "Usually" : "Expect"} highs of ${Math.min(...hi)}–${Math.max(...hi)}°C${lo.length ? ` and lows of ${Math.min(...lo)}–${Math.max(...lo)}°C` : ""}; ${rain}.`;
}

/** Public holidays that fall inside the trip. Pure. */
export function holidaysIn(all: { date: string; name: string; localName?: string | null }[], start: string | null, end: string | null) {
  if (!start) return [];
  const to = end ?? start;
  return all
    .filter((h) => h.date >= start && h.date <= to)
    .map((h) => ({ date: h.date, name: clean(h.name, 80), local: h.localName && h.localName !== h.name ? clean(h.localName, 80) : null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Tips that follow from the person's Qloo taste profile. Pure. */
export function tasteTips(taste: TasteOutput | null | undefined): { because: string; tip: string }[] {
  if (!taste) return [];
  const lead = taste.signals[0]?.name ?? taste.tags[0]?.name ?? "your taste";
  const out: { because: string; tip: string }[] = [];
  if (taste.zone?.name) out.push({ because: `Qloo's heatmap for ${lead}`, tip: `Spend your evenings around ${taste.zone.name}. It's where your taste is strongest in the city.` });
  for (const dish of taste.dishes.slice(0, 2)) out.push({ because: `Qloo links ${lead} to this`, tip: `Order ${dish}. It's what people with your taste reach for.` });
  for (const scene of taste.scenes.slice(0, 2)) out.push({ because: `Qloo links ${lead} to this`, tip: `Look for ${scene} spots. They're where your kind of crowd goes.` });
  for (const a of taste.alsoLoved.slice(0, 2)) out.push({ because: `People who love ${lead} also love`, tip: `${a.name}: worth a detour if you pass it.` });
  if (taste.audience) out.push({ because: "Who shares your taste", tip: `Your taste skews to people aged ${taste.audience}, so expect a ${taste.audience.startsWith("under") || /^(1|2)\d/.test(taste.audience) ? "younger, livelier" : "mixed"} crowd.` });
  return out.slice(0, 6);
}

// ---------- outside data ----------

async function getJson<T>(url: string, ctx: SkillContext, ms = 8000): Promise<T | null> {
  try {
    const t = AbortSignal.timeout(ms);
    const res = await fetch(url, { signal: ctx.signal ? AbortSignal.any([ctx.signal, t]) : t, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type OpenMeteo = { daily?: Daily; timezone?: string; utc_offset_seconds?: number };
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset";

async function loadWeather(ctx: SkillContext, lat: number, lon: number, dates: string[], today: string) {
  const empty = { basis: "none" as const, days: [] as DayWeather[], zone: null as string | null, offset: null as number | null };
  const horizon = addDays(today, 15);
  const useDates = dates.length ? dates : Array.from({ length: 5 }, (_, i) => addDays(today, i));
  const start = useDates[0];
  const end = useDates[useDates.length - 1];
  if (start >= today && end <= horizon) {
    const j = await getJson<OpenMeteo>(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${DAILY},precipitation_probability_max&timezone=auto&start_date=${start}&end_date=${end}`, ctx);
    const days = daysFromForecast(j?.daily);
    if (days.length) return { basis: "forecast" as const, days, zone: j?.timezone ?? null, offset: j?.utc_offset_seconds != null ? j.utc_offset_seconds / 3600 : null };
  }
  // Too far ahead for a forecast (or it failed): what the same dates were like in the last three years.
  const years = await Promise.all(
    [1, 2, 3].map((n) => getJson<OpenMeteo>(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=${DAILY}&timezone=auto&start_date=${shiftYears(start, -n)}&end_date=${shiftYears(end, -n)}`, ctx, 10000))
  );
  const good = years.filter((y): y is OpenMeteo => Boolean(y?.daily?.time?.length));
  if (!good.length) return empty;
  const days = daysFromHistory(useDates, good.map((y) => y.daily!));
  return { basis: "history" as const, days, zone: good[0].timezone ?? null, offset: good[0].utc_offset_seconds != null ? good[0].utc_offset_seconds / 3600 : null };
}

async function loadMoney(ctx: SkillContext, home: string | null, local: string | null) {
  const none = { local, home, rate: null as number | null, asOf: null as string | null, examples: [] as { home: number; local: number }[] };
  if (!home || !local || home === local) return none;
  const j = await getJson<{ result?: string; time_last_update_utc?: string; rates?: Record<string, number> }>(`https://open.er-api.com/v6/latest/${home}`, ctx);
  const rate = j?.result === "success" ? j.rates?.[local] : undefined;
  if (!rate || !Number.isFinite(rate)) return none;
  // Three significant figures: one decimal turned 1.15 into 1.2 and 0.00057 into 0.
  const nice = (x: number) => (x >= 100 ? Math.round(x) : Number(x.toPrecision(3)));
  return { local, home, rate: nice(rate), asOf: j?.time_last_update_utc ? new Date(j.time_last_update_utc).toISOString().slice(0, 10) : null, examples: [10, 50, 100].map((h) => ({ home: h, local: nice(h * rate) })) };
}

async function loadHolidays(ctx: SkillContext, cc: string | null, start: string | null, end: string | null) {
  if (!cc || !start) return [];
  const years = [...new Set([start.slice(0, 4), (end ?? start).slice(0, 4)])];
  const lists = await Promise.all(years.map((y) => getJson<{ date: string; name: string; localName?: string }[]>(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`, ctx)));
  return holidaysIn(lists.flatMap((l) => l ?? []), start, end);
}

// ---------- web research, read by the model ----------

const researchSchema = z.object({
  sections: z
    .array(z.object({ id: z.string(), items: z.array(z.object({ text: z.string(), source: z.string().nullable().optional() })).default([]) }))
    .default([]),
  emergency: z.object({ police: z.string().nullable().optional(), ambulance: z.string().nullable().optional(), fire: z.string().nullable().optional(), general: z.string().nullable().optional(), source: z.string().nullable().optional() }).nullable().optional(),
  phrases: z.array(z.object({ say: z.string(), means: z.string() })).default([]),
  guides: z.array(z.object({ name: z.string(), kind: z.string(), why: z.string(), source: z.string().nullable().optional() })).default([]),
});

async function search(ctx: SkillContext, q: string): Promise<WebResult[]> {
  if (!ctx.web) return [];
  const ac = new AbortController();
  const stop = () => ac.abort();
  ctx.signal?.addEventListener("abort", stop);
  try {
    // Room for slower providers (Claude web search takes 15-40 s); the abort stops the losing request.
    return await withTimeout(ctx.web.search(q, { maxResults: 5, need: "facts", signal: ac.signal }), 30_000, "intel search");
  } catch (err) {
    ac.abort();
    ctx.log.warn("intel search failed", { error: String(err).slice(0, 160) });
    return [];
  } finally {
    ctx.signal?.removeEventListener("abort", stop);
  }
}

type Research = { sections: TripIntelOutput["sections"]; emergency: TripIntelOutput["emergency"]; phrases: TripIntelOutput["phrases"]; guides: TripIntelOutput["guides"]; evidence: Evidence[] };

/** Reads the numbered sources into structured, cited items. Items the model couldn't tie to a source are kept but marked unverified. Pure given the model's answer. */
export function shapeResearch(raw: z.infer<typeof researchSchema>, sources: WebResult[]): Research {
  const byId = new Map(sources.map((s, i) => [`w${i + 1}`, s]));
  const used = new Set<string>();
  const cite = (id: string | null | undefined) => {
    const key = (id ?? "").trim().toLowerCase();
    const s = byId.get(key);
    if (s) used.add(key);
    return s ?? null;
  };
  const sections = SECTION_IDS.map((id) => {
    const found = raw.sections.filter((s) => s.id === id).flatMap((s) => s.items);
    const items = found
      .map((it) => {
        const text = clean(it.text, 240);
        const s = cite(it.source);
        return text ? { text, url: s?.url ?? null, site: s ? hostOf(s.url) : null, verified: Boolean(s) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, 5);
    return { id, title: SECTION_TITLES[id], items };
  }).filter((s) => s.items.length);
  const em = raw.emergency;
  const emSource = cite(em?.source);
  const emergency = em && [em.police, em.ambulance, em.fire, em.general].some(Boolean) ? { police: clean(em.police, 20) || null, ambulance: clean(em.ambulance, 20) || null, fire: clean(em.fire, 20) || null, general: clean(em.general, 20) || null, verified: Boolean(emSource) } : null;
  const phrases = raw.phrases.map((p) => ({ say: clean(p.say, 70), means: clean(p.means, 90) })).filter((p) => p.say && p.means).slice(0, 8);
  const guides = raw.guides
    .map((g) => {
      const s = cite(g.source);
      return s ? { name: clean(g.name, 90), kind: clean(g.kind, 40), why: clean(g.why, 200), url: s.url, site: hostOf(s.url) } : null;
    })
    .filter((g): g is NonNullable<typeof g> => g !== null && Boolean(g.name))
    .slice(0, 6);
  const evidence = [...used].map((id) => webEvidence(byId.get(id)!));
  return { sections, emergency, phrases, guides, evidence };
}

const EU_112 = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
/** Long-established national emergency numbers, as a fallback; always shown as unverified. Pure. */
export function knownEmergency(cc: string | null): TripIntelOutput["emergency"] {
  const c = (cc ?? "").toUpperCase();
  const n = (police: string | null, ambulance: string | null, fire: string | null, general: string | null) => ({ police, ambulance, fire, general, verified: false });
  if (EU_112.includes(c)) return n(null, null, null, "112");
  if (c === "GB") return n(null, null, null, "999 or 112");
  if (c === "US" || c === "CA") return n(null, null, null, "911");
  if (c === "AE") return n("999", "998", "997", null);
  if (c === "NG") return n(null, null, null, "112");
  if (c === "JP") return n("110", "119", "119", null);
  if (c === "AU") return n(null, null, null, "000");
  if (c === "IN") return n(null, null, null, "112");
  if (c === "KE") return n(null, null, null, "999 or 112");
  if (c === "ZA") return n("10111", "10177", null, "112 from a mobile");
  return null;
}

/** The first one or two readable sentences of a page excerpt, for showing a source as-is. Pure. */
export function excerpt(content: string, max = 220): string {
  // Drop markdown headings, list markers and table bars before picking sentences.
  const text = content
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join(" ")
    .replace(/[*_|>`]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-\s]+/, "")
    .trim();
  const sentences = text.match(/[^.!?]{25,}[.!?]/g) ?? [];
  const pick = sentences.slice(0, 2).join(" ").trim() || text;
  return clean(pick, max);
}

const GUIDE_NOISE = /\s*[-|–·:]\s*(?:tripadvisor|viator|getyourguide|klook|airbnb|expedia|the \d+ best.*|updated \d{4}).*$/i;

/**
 * Without a model to read the research, show it as found: a short excerpt from each source, linked,
 * grouped by what it was searched for, and the tour pages as guides. Never empty when the web answered. Pure.
 */
export function researchFromSources(groups: { id: SectionId; results: WebResult[] }[], guides: WebResult[]): Research | null {
  const sections = groups
    .map(({ id, results }) => ({
      id,
      title: SECTION_TITLES[id],
      items: results
        .slice(0, 3)
        .map((r) => ({ text: excerpt(r.content || r.title), url: r.url, site: hostOf(r.url), verified: true }))
        .filter((i) => i.text.length > 20),
    }))
    .filter((sec) => sec.items.length);
  const found = guides
    .slice(0, 5)
    .map((g) => ({ name: clean(g.title.replace(GUIDE_NOISE, ""), 90), kind: "tours and guides", why: excerpt(g.content || "", 200), url: g.url, site: hostOf(g.url) }))
    .filter((g) => g.name);
  if (!sections.length && !found.length) return null;
  const used = [...groups.flatMap((g) => g.results.slice(0, 3)), ...guides.slice(0, 5)];
  return { sections, emergency: null, phrases: [], guides: found, evidence: used.map((r) => webEvidence(r)) };
}

async function research(ctx: SkillContext, input: BriefInput, city: string, country: string | null, taste: TasteOutput | null | undefined, dates: string[]): Promise<Research | null> {
  if (!ctx.web && !ctx.llm) return null;
  const place = [city, country].filter(Boolean).join(", ");
  const year = (dates[0] ?? new Date().toISOString()).slice(0, 4);
  const tasteWords = taste ? [...taste.signals.slice(0, 2).map((s) => s.name), ...taste.scenes.slice(0, 2)].join(" ") : "";
  const [entry, safety, culture, guides] = await Promise.all([
    search(ctx, `${country ?? city} entry requirements visa tourists passport validity official travel advice ${year}`),
    search(ctx, `${place} travel safety scams areas to avoid at night emergency numbers police ambulance`),
    search(ctx, `${place} tipping etiquette customs dress code useful local phrases tap water SIM card eSIM plug type`),
    search(ctx, `${place} best local tour guide private guide walking tour food tour ${tasteWords}`.trim()),
  ]);
  const seen = new Set<string>();
  const sources = [...entry, ...safety, ...culture, ...guides].filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true))).slice(0, 18);
  // What the research found, shown as-is, when no model can read it for us.
  const asFound = () => researchFromSources([{ id: "entry", results: entry }, { id: "safety", results: safety }, { id: "culture", results: culture }], guides);
  if (!ctx.llm) return asFound();
  try {
    const raw = await ctx.llm.json({
      tier: "default",
      schema: researchSchema,
      maxTokens: 2400,
      temperature: 0.2,
      timeoutMs: 30000,
      signal: ctx.signal,
      purpose: "intel",
      system: [
        "You prepare the 'know before you go' briefing for a traveller. Be specific, current and practical.",
        sources.length ? "Use the numbered sources. Put the source id (w1, w2…) in each item's source. If an item isn't in any source, you may still add a widely known fact (like an emergency number), with source null." : "No sources are available. Add only widely known, stable facts, with source null, and nothing you aren't sure of.",
        "Never invent prices, phone numbers, opening hours, names or links. If you don't know, leave it out.",
        "Entry rules depend on the traveller's passport, which you don't know: state the common rule for most visitors, say it depends on nationality, and tell them to confirm on the destination's official government site.",
        "Sections (ids): entry (visa, passport validity, arrival forms), safety (scams, areas, night travel), health (vaccines, water, medicines), culture (tipping, dress, greetings, taboos), connect (SIM or eSIM, plug type and voltage, mobile data), transport (how people get around, airport transfer), food (what to eat, water, street food).",
        "At most 4 short items per section (one sentence each). Skip sections you have nothing reliable for.",
        "emergency: the local police, ambulance, fire and general numbers; source it if you can.",
        "phrases: up to 6 useful local-language phrases (say = how to write it, means = the English). Use the main language people will meet.",
        sources.length ? "guides: up to 5 real local guides, tour companies or experiences found in the sources that fit this traveller. Each needs the source id it came from. Don't include any you can't tie to a source." : "guides: leave empty.",
        taste ? `Their taste, read through Qloo: ${[...taste.signals.map((x) => x.name), ...taste.tags.map((x) => x.name)].join(", ")}${taste.vibes.length ? `; vibe ${taste.vibes.join(", ")}` : ""}${taste.scenes.length ? `; scenes ${taste.scenes.join(", ")}` : ""}. Prefer guides and experiences that fit it, and say why.` : "",
        UNTRUSTED_WEB_RULE,
        languageRule(input),
        'Shape: {"sections":[{"id":"safety","items":[{"text":"…","source":"w2"|null}]}],"emergency":{"police":"…","ambulance":"…","fire":"…","general":"…","source":"w3"|null},"phrases":[{"say":"…","means":"…"}],"guides":[{"name":"…","kind":"walking tour","why":"…","source":"w9"}]}',
      ]
        .filter(Boolean)
        .join("\n"),
      user: [`Destination: ${place}`, dates.length ? `Dates: ${dates[0]} to ${dates[dates.length - 1]}` : "Dates: not fixed", "", sources.length ? quoteWeb(sources) : "(no sources)"].join("\n"),
    });
    const shaped = shapeResearch(researchSchema.parse(raw), sources);
    // The model answered but tied nothing to a source: the sources themselves are better than nothing.
    return shaped.sections.length || shaped.guides.length ? shaped : (asFound() ?? shaped);
  } catch (err) {
    ctx.log.warn("Trip intel research failed", { error: String(err) });
    return asFound();
  }
}

// ---------- the skill ----------

export const tripIntel: Skill<BriefInput, TripIntelOutput> = {
  id: "trip.intel",
  title: "Know before you go",
  dependsOn: ["trip.agent"],
  optionalDeps: ["trip.taste"],
  timeoutMs: 85_000,
  output: intelOutput,
  async run(ctx, input, deps) {
    const a = agentOf(deps);
    const taste = deps["trip.taste"]?.data as TasteOutput | undefined;
    const city = a.where.city;
    const cityName = city?.name ?? a.trip.destination;
    const cc = city?.countryCode ?? null;
    const dates = tripDates(a.trip.startDate, a.trip.endDate);
    const today = input.today ?? new Date().toISOString().slice(0, 10);
    const home = (input.profile?.currency ?? a.trip.budget.currency ?? null)?.toUpperCase() ?? null;
    const local = countryCurrency(cc);
    const evidence: Evidence[] = [];
    const gaps: string[] = [];
    const step = (id: string, text: string) => ctx.progress?.({ kind: "act", text, id, tool: id });
    const saw = (id: string, text: string, ok = true) => ctx.progress?.({ kind: "saw", text, id, ok });

    step("weather", "Checking the weather for your dates");
    step("money", "Looking up the exchange rate");
    step("research", "Reading up on entry rules, safety and local guides");
    const [wx, money, holidays, web] = await Promise.all([
      city ? loadWeather(ctx, city.lat, city.lon, dates, today) : Promise.resolve({ basis: "none" as const, days: [] as DayWeather[], zone: null, offset: null }),
      loadMoney(ctx, home, local),
      loadHolidays(ctx, cc, a.trip.startDate, a.trip.endDate),
      withTimeout(research(ctx, input, cityName, city?.country ?? null, taste, dates), 75_000, "intel research").catch(() => null),
    ]);
    saw("weather", wx.days.length ? `Weather: ${wx.basis === "forecast" ? "forecast" : "what these dates are usually like"}` : "No weather for those dates", wx.days.length > 0);
    saw("money", money.rate ? `1 ${money.home} = ${money.rate} ${money.local}` : "Same currency or no rate found", true);
    saw("research", web ? `${web.sections.reduce((n, s) => n + s.items.length, 0)} notes, ${web.guides.length} guides` : "Couldn't finish the research", Boolean(web));

    if (wx.days.length) evidence.push({ source: "derived", label: "Weather", basis: `Open-Meteo ${wx.basis === "forecast" ? "forecast" : "history for the same dates"}` });
    else gaps.push("Weather for your dates");
    if (money.rate) evidence.push({ source: "derived", label: "Exchange rate", basis: `open.er-api.com, ${money.asOf ?? "latest"}` });
    if (holidays.length) evidence.push({ source: "derived", label: "Public holidays", basis: "Nager.Date" });
    if (web) evidence.push(...web.evidence);
    else gaps.push("Entry, safety and culture notes");
    if (web && !web.guides.length) gaps.push("Local guides");

    const packing = packingFrom(wx.days);
    return {
      data: {
        place: { city: cityName, country: city?.country ?? null, countryCode: cc, lat: city?.lat ?? null, lon: city?.lon ?? null },
        time: { zone: wx.zone, utcOffsetHours: wx.offset },
        weather: { basis: wx.basis, days: wx.days, summary: wx.basis === "none" ? null : weatherSummary(wx.days, wx.basis), packing },
        money,
        holidays,
        sections: web?.sections ?? [],
        // Well-known national numbers when the research didn't give them (marked unverified).
        emergency: web?.emergency ?? knownEmergency(cc),
        phrases: web?.phrases ?? [],
        guides: web?.guides ?? [],
        tasteTips: tasteTips(taste),
        gaps,
      },
      evidence,
    };
  },
};
