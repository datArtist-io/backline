// A trip or event request: what the planner extracts, how gaps are filled (with every assumption
// stated), and how it's described back to the model and the user.
import { z } from "zod";
import type { Profile, TripRequest } from "./types";
import { normalizeLocation } from "./location";

/** The loose shape a model extracts (planner or agent). Everything optional. */
export const rawTripSchema = z.object({
  destination: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  adults: z.number().nullable().optional(),
  rooms: z.number().nullable().optional(),
  budgetAmount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  budgetScope: z.enum(["total", "per_night"]).nullable().optional(),
  priceTier: z.number().nullable().optional(),
  purpose: z.string().nullable().optional(),
  eventType: z.string().nullable().optional(),
  eventGuests: z.number().nullable().optional(),
  eventDate: z.string().nullable().optional(),
  needs: z.array(z.enum(["stay", "dine", "venue", "activities"])).nullable().optional(),
  near: z.string().nullable().optional(),
  travelMode: z.string().nullable().optional(),
  selfArranged: z.array(z.string()).nullable().optional(),
  /** A celebrity or person whose taste the plan should follow. */
  inspiredBy: z.string().nullable().optional(),
  /** Things the user says they love in the request: artists, films, cuisines, genres. */
  likes: z.array(z.string()).nullable().optional(),
});
export type RawTrip = z.infer<typeof rawTripSchema>;

/** The complete, validated trip (matches TripRequest). */
export const tripRequestSchema = z.object({
  destination: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  adults: z.number(),
  rooms: z.number(),
  budget: z.object({ amount: z.number().nullable(), currency: z.string(), scope: z.enum(["total", "per_night"]).nullable() }),
  priceTier: z.number().nullable(),
  purpose: z.string().nullable(),
  event: z.object({ type: z.string(), guests: z.number().nullable(), date: z.string().nullable() }).nullable(),
  needs: z.array(z.enum(["stay", "dine", "venue", "activities"])),
  near: z.string().nullable(),
  travelMode: z.string().nullable(),
  selfArranged: z.array(z.string()),
  inspiredBy: z.string().nullable().optional(),
  likes: z.array(z.string()).optional(),
  assumptions: z.array(z.string()),
});

export const CURRENCIES: [RegExp, string][] = [
  [/nigeria|lagos|abuja|ibadan|port harcourt/i, "NGN"],
  [/ghana|accra/i, "GHS"],
  [/kenya|nairobi/i, "KES"],
  [/south africa|johannesburg|cape town/i, "ZAR"],
  [/united kingdom|\buk\b|england|london|manchester|scotland/i, "GBP"],
  [/france|paris|germany|berlin|spain|madrid|italy|rome|netherlands|amsterdam|portugal|lisbon/i, "EUR"],
  [/uae|dubai|abu dhabi/i, "AED"],
  [/japan|tokyo/i, "JPY"],
];

/** The country a currency points to, when it points to exactly one. Used to settle ambiguous place names. */
export const CURRENCY_COUNTRY: Record<string, string> = {
  NGN: "Nigeria",
  GHS: "Ghana",
  KES: "Kenya",
  ZAR: "South Africa",
  GBP: "United Kingdom",
  AED: "United Arab Emirates",
  JPY: "Japan",
  CAD: "Canada",
  RWF: "Rwanda",
  EGP: "Egypt",
  MAD: "Morocco",
  BRL: "Brazil",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (d: string | null | undefined, today: string) => (d && ISO.test(d) && !Number.isNaN(Date.parse(d)) && d >= today ? d : null);

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** Whether the text actually states this number ("2,000,000", "2m", "150k", "four", "a couple"). Pure. */
export function mentionsNumber(text: string, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const t = text.toLowerCase().replace(/(\d)[,\s](?=\d{3}\b)/g, "$1");
  const whole = Math.round(n);
  if (new RegExp(`(^|[^\\d])${whole}([^\\d]|$)`).test(t)) return true;
  for (const [div, unit] of [
    [1e6, "(?:m|mn|million|mil)"],
    [1e3, "(?:k|thousand|grand)"],
  ] as const) {
    if (n < div) continue;
    const v = Math.round((n / div) * 100) / 100;
    if (new RegExp(`(^|[^\\d.])${String(v).replace(".", "\\.")}\\s*${unit}\\b`).test(t)) return true;
  }
  if (whole <= 20 && new RegExp(`\\b${NUMBER_WORDS[whole]}\\b`).test(t)) return true;
  if (whole === 2 && /\b(a couple|both of us|me and my|my (?:wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?))\b/.test(t)) return true;
  if (whole === 12 && /\bdozen\b/.test(t)) return true;
  return false;
}

const HOSTING = /\b(host(?:ing)?|throw(?:ing)?|organi[sz](?:e|ing)|celebrat(?:e|ing)|my (?:own )?(?:birthday|wedding|party|launch|dinner|anniversary|shower)|our (?:wedding|party|launch|event|reception)|(?:book|need|find|get) (?:a |an )?(?:venue|hall|event (?:cent(?:re|er)|space)))\b/i;
const GENERIC_EVENT = /^(?:an? |the )?(?:event|show|concert|conference|summit|festival|meeting|ceremony|programme|program|play|performance|gig|exhibition|match|game)s?$/i;
const ATTENDING = /\b(attend(?:ing)?|going (?:there |down )?(?:for|to) (?:an?|the|some) (?:event|show|concert|conference|wedding|play|programme|program)|for an event|ticket(?:s)? (?:for|to)|invited to)\b/i;
const HOSTED_KIND = /\b(birthday|dinner|lunch|brunch|party|wedding|reception|launch|anniversary|shower|meetup|retreat|offsite|gala|banquet)\b/i;

const NAME_FILLER = new Set(["the", "and", "for", "near", "hotel", "restaurant", "club", "bar"]);

/** Whether any real word of a name appears in the text, ignoring case and accents. Pure. */
function saidIn(text: string, name: string): boolean {
  const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const said = fold(text);
  return fold(name)
    .split(/\s+/)
    .some((w) => w.length > 2 && !NAME_FILLER.has(w) && said.includes(w));
}

/**
 * Keep only what the user actually said. Models copy example values and mistake attending an
 * event for hosting one, so: numbers not stated in the text are dropped, and an "event" with no
 * sign of hosting becomes the trip's purpose instead. People and tastes must be ones they named. Pure.
 */
export function groundTrip(raw: RawTrip | null | undefined, text: string, opts: { near?: boolean } = {}): RawTrip | null {
  if (!raw) return null;
  const out: RawTrip = { ...raw };
  if (out.budgetAmount != null && !mentionsNumber(text, out.budgetAmount)) {
    out.budgetAmount = null;
    out.budgetScope = null;
  }
  if (out.eventGuests != null && !mentionsNumber(text, out.eventGuests)) out.eventGuests = null;
  if (out.adults != null && out.adults > 2 && !mentionsNumber(text, out.adults)) out.adults = null;
  if (out.rooms != null && out.rooms > 1 && !mentionsNumber(text, out.rooms)) out.rooms = null;
  // A person to take taste from must be someone the user named.
  // So must the things they love.
  if (out.inspiredBy && !saidIn(text, out.inspiredBy)) out.inspiredBy = null;
  if (out.likes?.length) out.likes = out.likes.filter((l) => saidIn(text, l));
  // From the first read of a request, a landmark must be one they named (models copy the example).
  if (opts.near && out.near && !saidIn(text, out.near)) out.near = null;
  // A taste ("seafood", "jazz") isn't a place to be near.
  if (out.near && out.likes?.some((l) => l.trim().toLowerCase() === out.near!.trim().toLowerCase())) out.near = null;
  const type = out.eventType?.trim();
  const hosting = HOSTING.test(text);
  const attending = type && !hosting && (GENERIC_EVENT.test(type) || (ATTENDING.test(text) && !HOSTED_KIND.test(type)) || out.eventGuests === 1);
  if (type && attending) {
    const what = /^(?:an?|the)\s/i.test(type) ? type : `${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}`;
    out.purpose = out.purpose?.trim() || `Attending ${what}`;
    out.eventType = null;
    out.eventGuests = null;
    if (out.needs) out.needs = out.needs.filter((n) => n !== "venue");
  }
  return out;
}

/** Turn whatever was extracted into a complete trip, stating every assumption. Pure. */
export function normalizeTrip(raw: RawTrip | null | undefined, fallbackDestination: string | null, profile: Profile = {}, today = new Date().toISOString().slice(0, 10)): TripRequest | null {
  let destination: string | null = null;
  try {
    destination = normalizeLocation(raw?.destination ?? fallbackDestination);
  } catch {
    destination = null;
  }
  if (!destination) return null;
  const assumptions: string[] = [];
  let startDate = validDate(raw?.startDate, today);
  let endDate = validDate(raw?.endDate, today);
  if (startDate && endDate && endDate < startDate) endDate = null;
  if (startDate && !endDate) {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 2);
    endDate = d.toISOString().slice(0, 10);
    assumptions.push("Assumed a 2-night stay");
  }
  if (!startDate) assumptions.push("No dates yet, so the plan is by day. Tell me dates to book");
  const eventType = raw?.eventType?.trim().slice(0, 60) || null;
  const eventGuests = raw?.eventGuests && raw.eventGuests > 0 ? Math.min(2000, Math.round(raw.eventGuests)) : null;
  let adults = raw?.adults && raw.adults > 0 ? Math.min(50, Math.round(raw.adults)) : 0;
  if (!adults) {
    adults = 1;
    assumptions.push("Assumed 1 traveller");
  }
  const rooms = raw?.rooms && raw.rooms > 0 ? Math.min(25, Math.round(raw.rooms)) : Math.max(1, Math.ceil(adults / 2));
  const currency = (raw?.currency?.trim().toUpperCase().slice(0, 3) || profile.currency || CURRENCIES.find(([re]) => re.test(destination!))?.[1] || "USD").replace(/[^A-Z]/g, "") || "USD";
  let priceTier = raw?.priceTier && raw.priceTier >= 1 && raw.priceTier <= 4 ? Math.round(raw.priceTier) : null;
  if (!priceTier && profile.budgetStyle) priceTier = profile.budgetStyle === "budget" ? 1 : profile.budgetStyle === "mid" ? 2 : 4;
  if (!priceTier && !raw?.budgetAmount) {
    priceTier = 2;
    assumptions.push("No budget given, so I aimed mid-range");
  }
  let needs = (raw?.needs ?? []).filter((n, i, a) => a.indexOf(n) === i);
  if (needs.length === 0) needs = ["stay", "dine"];
  if (eventType && !needs.includes("venue") && !/dinner|lunch|brunch/i.test(eventType)) needs.push("venue");
  if (eventType && /dinner|lunch|brunch/i.test(eventType) && !needs.includes("dine")) needs.push("dine");
  return {
    destination,
    startDate,
    endDate,
    adults,
    rooms,
    budget: { amount: raw?.budgetAmount && raw.budgetAmount > 0 ? raw.budgetAmount : null, currency, scope: raw?.budgetScope ?? (raw?.budgetAmount ? "total" : null) },
    priceTier,
    purpose: raw?.purpose?.trim().slice(0, 120) || null,
    event: eventType ? { type: eventType, guests: eventGuests, date: validDate(raw?.eventDate, today) } : null,
    needs,
    near: raw?.near?.replace(/[<>]/g, "").trim().slice(0, 80) || null,
    travelMode: raw?.travelMode?.replace(/[<>]/g, "").trim().slice(0, 30) || null,
    selfArranged: (raw?.selfArranged ?? []).map((x) => x.replace(/[<>]/g, "").trim().slice(0, 40)).filter(Boolean).slice(0, 5),
    inspiredBy: raw?.inspiredBy?.replace(/[<>"]/g, "").trim().slice(0, 60) || null,
    likes: [...new Set((raw?.likes ?? []).map((l) => l.replace(/[<>"]/g, "").trim().slice(0, 50)).filter(Boolean))].slice(0, 5),
    assumptions,
  };
}

/**
 * A trip with only defaults, for when the request leaves everything to an attached document:
 * the agent reads the document and fills it in with update_trip. Pure.
 */
export function blankTrip(profile: Profile = {}): TripRequest {
  return {
    destination: "",
    startDate: null,
    endDate: null,
    adults: 1,
    rooms: 1,
    budget: { amount: null, currency: profile.currency ?? "USD", scope: null },
    priceTier: profile.budgetStyle === "budget" ? 1 : profile.budgetStyle === "luxury" ? 4 : 2,
    purpose: null,
    event: null,
    needs: ["stay", "dine"],
    near: null,
    travelMode: null,
    selfArranged: [],
    assumptions: ["Working out the details from your document", "Assumed 1 traveller", ...(profile.budgetStyle ? [] : ["No budget given, so I aimed mid-range"])],
  };
}

/** The loose shape of a complete trip, so it can be updated field by field and normalised again. Pure. */
export function rawFromTrip(t: TripRequest): RawTrip {
  return {
    destination: t.destination,
    startDate: t.startDate,
    endDate: t.endDate,
    adults: t.adults,
    rooms: t.rooms,
    budgetAmount: t.budget.amount,
    currency: t.budget.currency,
    budgetScope: t.budget.scope,
    priceTier: t.priceTier,
    purpose: t.purpose,
    eventType: t.event?.type ?? null,
    eventGuests: t.event?.guests ?? null,
    eventDate: t.event?.date ?? null,
    needs: t.needs,
    near: t.near,
    travelMode: t.travelMode,
    selfArranged: t.selfArranged,
    inspiredBy: t.inspiredBy ?? null,
    likes: t.likes ?? [],
  };
}

/** Which field each standard assumption is about, so a correction clears the right one. */
const ASSUMPTION_FIELDS: [RegExp, (keyof RawTrip)[]][] = [
  [/from your document/i, ["destination"]],
  [/2-night/i, ["endDate", "startDate"]],
  [/no dates/i, ["startDate"]],
  [/1 traveller/i, ["adults"]],
  [/mid-range/i, ["priceTier", "budgetAmount"]],
];

/**
 * Apply a partial correction to a trip (from the agent or the user) and normalise again. Earlier
 * assumptions survive unless the correction covers them. Returns null if there's no destination. Pure.
 */
export function updateTrip(current: TripRequest, patch: RawTrip, profile: Profile = {}, today = new Date().toISOString().slice(0, 10)): TripRequest | null {
  const changes = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as RawTrip;
  const merged: RawTrip = { ...rawFromTrip(current), ...changes };
  // A blank trip's placeholder currency shouldn't override the destination's own.
  if (!current.destination && !changes.currency) merged.currency = null;
  // An assumed end date shouldn't survive a new start date.
  if (changes.startDate && !changes.endDate && current.assumptions.some((a) => /2-night/i.test(a))) merged.endDate = null;
  const next = normalizeTrip(merged, merged.destination ?? current.destination, profile, today);
  if (!next) return null;
  // The merged trip spells out every earlier value, so normalising only adds assumptions for what
  // is still missing. Earlier assumptions stay unless this correction covered them.
  const touched = new Set(Object.keys(changes));
  const kept = current.assumptions.filter((a) => {
    const fields = ASSUMPTION_FIELDS.find(([re]) => re.test(a))?.[1];
    return fields ? !fields.some((f) => touched.has(f)) : true;
  });
  next.assumptions = [...new Set([...kept, ...next.assumptions])];
  return next;
}

const fmt = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const NEED_WORDS: Record<TripRequest["needs"][number], string> = { stay: "a place to stay", dine: "restaurants", venue: "an event venue", activities: "things to do" };

/** One paragraph a model (or a person) can read to know the whole request. Pure. */
export function describeTrip(t: TripRequest): string {
  const parts = [
    `Destination: ${t.destination || "not known yet"}.`,
    t.startDate ? `Dates: ${fmt(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` to ${fmt(t.endDate)}` : ""}.` : "Dates: not given.",
    `Travellers: ${t.adults} adult${t.adults === 1 ? "" : "s"}, ${t.rooms} room${t.rooms === 1 ? "" : "s"}.`,
    t.budget.amount
      ? `Budget: ${t.budget.amount.toLocaleString("en")} ${t.budget.currency}${t.budget.scope === "per_night" ? " per night" : " in total"}${t.priceTier ? ` (price level ${t.priceTier} of 4)` : ""}.`
      : `Budget: ${t.priceTier === 1 ? "budget" : t.priceTier === 4 ? "luxury" : t.priceTier === 3 ? "upper mid-range" : "mid-range"} (price level ${t.priceTier ?? 2} of 4), currency ${t.budget.currency}.`,
    `Needs: ${t.needs.map((n) => NEED_WORDS[n]).join(", ")}.`,
    t.near ? `Wants to be near: ${t.near}.` : "",
    t.purpose ? `Purpose: ${t.purpose}.` : "",
    t.event ? `Hosting: ${t.event.type}${t.event.guests ? ` for ${t.event.guests} guests` : ""}${t.event.date ? ` on ${fmt(t.event.date)}` : ""}.` : "",
    t.likes?.length ? `Loves: ${t.likes.join(", ")}.` : "",
    t.inspiredBy ? `Wants the plan to follow ${t.inspiredBy}'s taste (places fans of ${t.inspiredBy} love).` : "",
    t.travelMode ? `Travelling by ${t.travelMode}${t.selfArranged.includes("transport") ? " (the user is arranging and paying for it)" : ""}.` : "",
    t.selfArranged.length && !(t.travelMode && t.selfArranged.length === 1 && t.selfArranged[0] === "transport") ? `The user handles themselves: ${t.selfArranged.join(", ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}
