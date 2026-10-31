// A trip or event request: what the planner extracts, how gaps are filled (with every assumption
// stated), and how it's described back to the model and the user.
import { z } from "zod";
import type { Profile, TripRequest } from "./types";
import { normalizeLocation } from "./location";
import { addDays, readTime, readWhen } from "./when";

// Models slip: "2" for 2, "per night" for per_night, ["activity"] for ["activities"], "£" for GBP.
// One slip used to fail the whole answer and drop the plan to keywords, so every field is forgiving:
// a value that can't be read becomes null instead of failing the rest.
const looseNum = z
  .preprocess((v) => (typeof v === "string" ? (v.trim() ? Number(v.replace(/[,\s]/g, "").replace(/[^\d.-]/g, "")) : null) : v), z.number().finite().nullable().optional())
  .catch(null);
const looseStr = z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string().nullable().optional()).catch(null);
const looseList = z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string()).nullable().optional()).catch(null);
const NEED_ALIASES: Record<string, "stay" | "dine" | "venue" | "activities"> = {
  stay: "stay", hotel: "stay", hotels: "stay", accommodation: "stay", lodging: "stay", room: "stay",
  dine: "dine", dining: "dine", food: "dine", restaurant: "dine", restaurants: "dine", eat: "dine", dinner: "dine", meals: "dine",
  venue: "venue", venues: "venue", event: "venue",
  activities: "activities", activity: "activities", things: "activities", sightseeing: "activities", experiences: "activities", tours: "activities",
};
const looseNeeds = z
  .preprocess(
    (v) => (Array.isArray(v) ? [...new Set(v.map((n) => NEED_ALIASES[String(n).trim().toLowerCase()]).filter(Boolean))] : null),
    z.array(z.enum(["stay", "dine", "venue", "activities"])).nullable().optional()
  )
  .catch(null);
const looseScope = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.toLowerCase();
    return /night/.test(t) ? "per_night" : /total|whole|overall|all/.test(t) ? "total" : null;
  }, z.enum(["total", "per_night"]).nullable().optional())
  .catch(null);

/** The loose shape a model extracts (planner or agent). Everything optional and forgiving. */
export const rawTripSchema = z.object({
  destination: looseStr,
  startDate: looseStr,
  endDate: looseStr,
  adults: looseNum,
  rooms: looseNum,
  budgetAmount: looseNum,
  currency: looseStr,
  budgetScope: looseScope,
  priceTier: looseNum,
  purpose: looseStr,
  eventType: looseStr,
  eventGuests: looseNum,
  eventDate: looseStr,
  needs: looseNeeds,
  near: looseStr,
  travelMode: looseStr,
  origin: looseStr,
  selfArranged: looseList,
  /** A celebrity or person whose taste the plan should follow. */
  inspiredBy: looseStr,
  /** Things the user says they love in the request: artists, films, cuisines, genres. */
  likes: looseList,
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
  origin: z.string().nullable().optional(),
  selfArranged: z.array(z.string()),
  inspiredBy: z.string().nullable().optional(),
  likes: z.array(z.string()).optional(),
  /** Children travelling, by age (rooms and rates are priced for them too). */
  children: z.array(z.number()).optional(),
  assumptions: z.array(z.string()),
});

export const CURRENCIES: [RegExp, string][] = [
  [/nigeria|lagos(?![^]*portugal)|abuja|ibadan|port harcourt/i, "NGN"],
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

const CURRENCY_SYMBOLS: Record<string, string> = { "£": "GBP", pound: "GBP", pounds: "GBP", "€": "EUR", euro: "EUR", euros: "EUR", $: "USD", dollar: "USD", dollars: "USD", "₦": "NGN", naira: "NGN", "¥": "JPY", yen: "JPY", "₹": "INR", "₵": "GHS", ksh: "KES" };
/** A real calendar date on or after today. A past date the model put in the wrong year moves to next year. Pure. */
export const validDate = (d: string | null | undefined, today: string): string | null => {
  if (!d || !ISO.test(d)) return null;
  const x = new Date(`${d}T12:00:00Z`);
  // "2026-02-30" parses, but isn't a day: reject it rather than send it to hotels and airlines.
  if (Number.isNaN(+x) || x.toISOString().slice(0, 10) !== d) return null;
  if (d >= today) return d;
  x.setUTCFullYear(x.getUTCFullYear() + 1);
  const next = x.toISOString().slice(0, 10);
  // Only a near miss (in December, "Jan 5" given as this January): never a date years back.
  return next >= today && next.slice(5) === d.slice(5) && Date.parse(next) - Date.parse(today) < 330 * 864e5 ? next : null;
};

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
export function saidIn(text: string, name: string): boolean {
  const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const said = fold(text);
  return fold(name)
    .split(/[^\p{L}\p{N}]+/u)
    .some((w) => w.length > 2 && !NAME_FILLER.has(w) && said.includes(w));
}

/**
 * Keep only what the user actually said. Models copy example values and mistake attending an
 * event for hosting one, so: numbers not stated in the text are dropped, and an "event" with no
 * sign of hosting becomes the trip's purpose instead. People and tastes must be ones they named. Pure.
 */
const SELF_HANDLED = /\b(myself|ourselves|on my own dime|i'?ll (?:pay|handle|book|sort|arrange|cover|get)|we'?ll (?:pay|handle|book|sort|arrange|cover|get)|i'?m (?:driving|taking care of)|already (?:booked|bought|have)|(?:i|we) (?:have|got) (?:my|our) (?:own )?(?:flight|ticket|tickets|car|ride|transport))\b/i;
const COMPANY = /\b(we|us|our|couple|partner|wife|husband|girlfriend|boyfriend|fianc[eé]e?|friend|friends|bae|two of us|with (?:my|a) \w+)\b/i;

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
  if (out.origin && !saidIn(text, out.origin)) out.origin = null;
  // Only skip booking something when they said they'd handle it; models fill this in from "from Lagos".
  if (out.selfArranged?.length && !SELF_HANDLED.test(text)) out.selfArranged = [];
  // Two travellers only when the request suggests company.
  if (out.adults === 2 && !mentionsNumber(text, 2) && !COMPANY.test(text)) out.adults = null;
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
  // No dates: plan the coming long weekend, so weather, fares and availability can all be checked.
  if (!startDate) {
    const w = weekendDates("a long weekend", today);
    if (w) {
      startDate = w.startDate;
      endDate = w.endDate;
      assumptions.push("No dates given, so I planned the coming long weekend (Friday to Monday). Tell me your dates to change it");
    } else assumptions.push("No dates yet, so the plan is by day. Tell me dates to book");
  }
  const eventType = raw?.eventType?.trim().slice(0, 60) || null;
  const eventGuests = raw?.eventGuests && raw.eventGuests > 0 ? Math.min(2000, Math.round(raw.eventGuests)) : null;
  let adults = raw?.adults && raw.adults > 0 ? Math.min(50, Math.round(raw.adults)) : 0;
  if (!adults) {
    adults = 1;
    assumptions.push("Assumed 1 traveller");
  }
  const rooms = raw?.rooms && raw.rooms > 0 ? Math.min(25, Math.round(raw.rooms)) : Math.max(1, Math.ceil(adults / 2));
  // "£" or "pounds" from the model is a currency too; only a real 3-letter code counts, then the profile, then the place.
  const given = raw?.currency?.trim() ?? "";
  const iso = (CURRENCY_SYMBOLS[given.toLowerCase()] ?? given.toUpperCase()).replace(/[^A-Z]/g, "").slice(0, 3);
  const currency = (iso.length === 3 ? iso : "") || profile.currency || CURRENCIES.find(([re]) => re.test(destination!))?.[1] || "USD";
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
    origin: raw?.origin?.replace(/[<>"]/g, "").trim().slice(0, 80) || null,
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
    origin: t.origin ?? null,
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
    t.origin ? `Travelling from ${t.origin}.` : "",
    t.travelMode ? `Travelling by ${t.travelMode}${t.selfArranged.includes("transport") ? " (the user is arranging and paying for it)" : ""}.` : "",
    t.selfArranged.length && !(t.travelMode && t.selfArranged.length === 1 && t.selfArranged[0] === "transport") ? `The user handles themselves: ${t.selfArranged.join(", ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * "A weekend", "this weekend", "next weekend", "a long weekend" resolved on the calendar, not by the
 * model (which gets weekdays wrong). Returns null when the text doesn't ask for a weekend. Pure.
 * - A weekend is Friday to Sunday; a long weekend Friday to Monday.
 * - "This weekend" or "a weekend": the coming one (from Saturday, today to Sunday; on Sunday, the next).
 * - "Next weekend": the coming Friday, or the one after when today is already Friday–Sunday.
 */
export function weekendDates(text: string, today: string): { startDate: string; endDate: string } | null {
  const t = text.toLowerCase();
  if (!/\bweekend\b/.test(t)) return null;
  // An explicit date wins ("the weekend of the 14th", "weekend in March").
  if (/\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{1,2}\/\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(christmas|easter|new year)/.test(t)) return null;
  const d = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay(); // 0 Sunday … 6 Saturday
  const next = /\bnext weekend\b/.test(t);
  const long = /\blong weekend\b/.test(t);
  const add = (n: number) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  let toFriday = (5 - dow + 7) % 7;
  if (next && (dow === 5 || dow === 6 || dow === 0)) toFriday = dow === 0 ? 5 : toFriday + 7;
  if (!next && dow === 0) toFriday = 5;
  if (!next && dow === 6) return { startDate: add(0), endDate: add(long ? 2 : 1) };
  return { startDate: add(toFriday), endDate: add(toFriday + (long ? 3 : 2)) };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * "Tonight", "tomorrow", "this Friday", "on Saturday", "next Monday" resolved on the calendar, not by
 * the model (which gets weekdays wrong). Returns the day (YYYY-MM-DD) or null when the text names no
 * such day or gives an explicit date. A weekday is the coming one, today included for "this"/bare
 * names; "next <day>" is the coming one after today. Pure.
 */
export function dayDate(text: string, today: string): string | null {
  const t = text.toLowerCase();
  if (/\bweekend\b/.test(t)) return null;
  if (/\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{1,2}\/\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/.test(t)) return null;
  const d = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const add = (n: number) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  if (/\b(tonight|today|this evening)\b/.test(t)) return add(0);
  if (/\btomorrow\b/.test(t)) return add(1);
  const m = t.match(/\b(this|on|next|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!m) return null;
  const target = WEEKDAYS.indexOf(m[2]);
  let n = (target - d.getUTCDay() + 7) % 7;
  if (m[1] === "next" && n === 0) n = 7;
  return add(n);
}

/** "at 8pm", "8:30 pm", "20:00", "at 8" (evening meals) → "20:00". Null when no time is asked for. Pure. */
export function askedTime(text: string): string | null {
  return readTime(text);
}

const MEAL_WORD = /\b(breakfast|brunch|lunch|dinner|supper|drinks|table)\b/;

/**
 * Keeps the time the person asked for: the meal they named ("dinner at 8pm") is set to that time on
 * the day it falls, whatever the model wrote. Returns the days unchanged when no time was asked. Pure.
 */
export function holdAskedTime<D extends { date: string | null; items: { time: string; title: string; placeId: string | null }[] }>(days: D[], request: string, isMealPlace: (id: string) => boolean, onDate: string | null = null): D[] {
  const time = askedTime(request);
  if (!time) return days;
  // The day they asked for comes first ("this Friday at 8pm"), then the rest in order.
  const order = onDate ? [...days.filter((d) => d.date === onDate), ...days.filter((d) => d.date !== onDate)] : days;
  // Only a meal or table booking: "flight at 9am" must not move a restaurant.
  const meal = request.toLowerCase().match(MEAL_WORD)?.[1] ?? null;
  if (!meal) return days;
  for (const d of order) {
    const i = d.items.findIndex((it) => it.placeId != null && isMealPlace(it.placeId));
    const named = meal && meal !== "table" ? d.items.findIndex((it) => new RegExp(`\\b${meal}\\b`, "i").test(it.title) && it.placeId != null) : -1;
    const at = named >= 0 ? named : i;
    if (at < 0) continue;
    const items = d.items.map((it, k) => (k === at ? { ...it, time } : it));
    items.sort((a, b) => (/^\d{2}:\d{2}/.test(a.time) && /^\d{2}:\d{2}/.test(b.time) ? a.time.localeCompare(b.time) : 0));
    const out = days.slice();
    out[days.indexOf(d)] = { ...d, items };
    return out;
  }
  return days;
}


const LOCAL_ONLY = /\b(dinner|lunch|brunch|breakfast|table|drinks|supper|reservation)\b/i;
const NEEDS_STAY = /\b(hotel|stay|night|nights|trip|weekend|holiday|vacation|getaway|accommodation|airbnb|room)\b/i;

/** "Dinner for 2 on Saturday at 8pm": one meal is all they asked for, not a day out. Pure. */
export function justAMeal(text: string): boolean {
  return LOCAL_ONLY.test(text) && !NEEDS_STAY.test(text) && !/\b(things to do|activities|explore|tours?|sightseeing|day out|plan (?:my|our|the) day|events?|concerts?|shows?|museums?|galler(?:y|ies)|parks?|beach|visit|see|walk|cinema|movie|club|party|and then|after(?:wards)?|before)\b/i.test(text);
}

/**
 * A meal or table in the person's own city is an outing, not a trip: one day, no hotel. Returns the
 * trip unchanged otherwise. Pure.
 */
export function localOuting(trip: TripRequest, text: string, home: string | null): TripRequest {
  const city = (s: string | null | undefined) => (s ?? "").split(",")[0].trim().toLowerCase();
  if (!home || !city(home) || city(home) !== city(trip.destination)) return trip;
  if (!LOCAL_ONLY.test(text) || NEEDS_STAY.test(text)) return trip;
  return {
    ...trip,
    endDate: trip.startDate,
    needs: trip.needs.filter((n) => n !== "stay").length ? trip.needs.filter((n) => n !== "stay") : ["dine"],
    // One line says it all: no "no hotel" twice, and no "travelling from" for a night out at home.
    assumptions: [...trip.assumptions.filter((a) => !/night stay|one outing|travelling from|from your connection/i.test(a)), "It's in your own city, so no hotel: just the evening"],
  };
}

// ---------- the dates and length the person asked for ----------

const MONTHS3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RX = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";

/** "Nov 14 to 16", "14-16 November": the check-in and check-out dates (the next such dates). Pure. */
export function dateRangeIn(text: string, today = new Date().toISOString().slice(0, 10)): { startDate: string; endDate: string } | null {
  const t = text.toLowerCase();
  const a = t.match(new RegExp(`\\b(${MONTH_RX})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|until|till|through|-|–)\\s*(?:(${MONTH_RX})\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  const b = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|until|till|through|-|–)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RX})`));
  const c = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RX})\\s*(?:to|until|till|through|-|–)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RX})`));
  let m1: number, d1: number, m2: number, d2: number;
  if (c) [m1, d1, m2, d2] = [MONTHS3.indexOf(c[2].slice(0, 3)) + 1, Number(c[1]), MONTHS3.indexOf(c[4].slice(0, 3)) + 1, Number(c[3])];
  else if (a) [m1, d1, m2, d2] = [MONTHS3.indexOf(a[1].slice(0, 3)) + 1, Number(a[2]), a[3] ? MONTHS3.indexOf(a[3].slice(0, 3)) + 1 : MONTHS3.indexOf(a[1].slice(0, 3)) + 1, Number(a[4])];
  else if (b) [m1, d1, m2, d2] = [MONTHS3.indexOf(b[3].slice(0, 3)) + 1, Number(b[1]), MONTHS3.indexOf(b[3].slice(0, 3)) + 1, Number(b[2])];
  else return null;
  if (!m1 || !m2 || d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let year = Number(today.slice(0, 4));
  if (iso(year, m1, d1) < today) year += 1;
  const startDate = iso(year, m1, d1);
  const endDate = iso(m2 < m1 ? year + 1 : year, m2, d2);
  return endDate > startDate ? { startDate, endDate } : null;
}

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, "a couple of": 2, "a few": 3 };
const COUNT_RX = "(\\d{1,4}|a couple of|a few|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)";
/** Longest stay read from a request: three years. */
const MAX_NIGHTS = 1095;
const count = (w: string) => (/^\d/.test(w) ? Number(w) : (COUNT[w] ?? NaN));

/**
 * How many nights the request asks for: "3 nights" → 3, "7 days" / "a 7-day trip" → 6, "a week" → 6 (seven days, like "7 days"; a month is 30 days, a year 365),
 * "2 weeks" → 13, "overnight" → 1, "a day trip" / "one day in Rome" → 0. Null when it doesn't say.
 * "In 3 days" (when, not how long) doesn't count. Pure.
 */
export function statedNights(text: string): number | null {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  // "Dinner for 4 tonight": one evening, no hotel.
  if (LOCAL_ONLY.test(t) && !NEEDS_STAY.test(t)) return 0;
  if (/(?<![\w]-)\bday[- ]trip\b|\bfor the day\b|\bsame[- ]day\b|\b(?:one|1|a|single)[- ]day (?:in|at|out|trip|visit|tour)\b|\bfor (?:one|a|1) day\b|\bspend (?:a|one|the) day\b/.test(t)) return 0;
  const notWhen = "(?<!\\bin )(?<!\\bwithin )(?<!\\bevery )";
  const n = t.match(new RegExp(`${notWhen}\\b${COUNT_RX}[\\s-]+nights?\\b`));
  if (n) return Math.min(MAX_NIGHTS, count(n[1]));
  if (/\bovernight\b/.test(t)) return 1;
  const w = t.match(new RegExp(`${notWhen}\\b${COUNT_RX}[\\s-]+weeks?\\b(?! (?:from now|later|ago|before|after|time))`));
  if (w && !/\b(?:next|this|last) week\b/.test(w[0])) return Math.min(MAX_NIGHTS, 7 * count(w[1]) - 1);
  if (/\bweek-?long\b/.test(t)) return 6;
  const fn = t.match(new RegExp(`\\b(?:a|one|1|two|2|three|3)\\s+fortnights?\\b`));
  if (fn) return Math.min(MAX_NIGHTS, 14 * (/(two|2)\s/.test(fn[0]) ? 2 : /(three|3)\s/.test(fn[0]) ? 3 : 1) - 1);
  // Months and years, for long stays: "6 months", "a year", "half a year", "2 years".
  if (/\bhalf (?:a )?year\b/.test(t)) return 181;
  const mo = t.match(new RegExp(`${notWhen}\\b${COUNT_RX}[\\s-]+months?\\b(?! (?:from now|later|ago|before|after|time))`));
  if (mo && !/\b(?:next|this|last) month\b/.test(mo[0])) return Math.min(MAX_NIGHTS, Math.round(30.44 * count(mo[1])) - 1);
  const yr = t.match(new RegExp(`${notWhen}\\b${COUNT_RX}[\\s-]+years?\\b(?! (?:from now|later|ago|before|after|time|old))`));
  if (yr && !/\b(?:next|this|last) year\b/.test(yr[0])) return Math.min(MAX_NIGHTS, 365 * count(yr[1]) - 1);
  const d = t.match(new RegExp(`${notWhen}\\b(\\d{1,4}|a couple of|a few|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)[\\s-]+days?\\b(?! (?:from now|later|ago|before|after|time|notice))`));
  if (d) return Math.max(0, Math.min(MAX_NIGHTS, count(d[1]) - 1));
  return null;
}


/**
 * The plan's dates exactly as asked: an explicit range ("Nov 14 to 16") is pinned as given, and a
 * stated length ("7 days", "3 nights", "a day trip") sets the end from the start, whatever the model
 * or a default chose. A day trip drops the hotel. Pure.
 */
export function pinStatedDates(trip: TripRequest, text: string, today = new Date().toISOString().slice(0, 10), opts: { dayFirst?: boolean } = {}): TripRequest {
  const when = readWhen(text, today, opts);
  const nights = statedNights(text);
  if (!when.start && nights == null) return when.notes.length ? { ...trip, assumptions: [...trip.assumptions, ...when.notes] } : trip;
  const gap = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
  const start = when.start ?? trip.startDate;
  if (!start) return trip;
  // The end: a range they wrote, else their stated length, else the length already planned (or two nights).
  // A named day or holiday ("New Year's Eve", "Christmas") with a length ("3 nights") starts there and runs on.
  const oneDay = when.end != null && (when.end === when.start || when.soft);
  let end = (oneDay && nights != null && nights > 0 ? null : when.end) ?? (nights != null ? addDays(start, nights) : null);
  const keptLength = trip.startDate && trip.endDate ? Math.max(0, gap(trip.startDate, trip.endDate)) : 2;
  if (!end) end = addDays(start, keptLength);
  const stated = Boolean(when.end || nights != null);
  const defaulted = !when.start && trip.assumptions.some((a) => /long weekend|No dates/i.test(a));
  const assumptions = trip.assumptions.filter((a) => !/long weekend|No dates|No start date/i.test(a) && !(stated && /2-night stay/i.test(a)));
  if (!when.start && !stated) return trip;
  if (when.start && !stated && !assumptions.some((a) => /night stay/i.test(a))) assumptions.push(`You didn't say how long, so I planned ${keptLength} night${keptLength === 1 ? "" : "s"}. Tell me if it's longer`);
  const day = new Date(`${start}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  if (defaulted) assumptions.push(`No start date given, so it starts ${day}. Tell me your dates to change it`);
  assumptions.push(...when.notes);
  const nightsNow = gap(start, end);
  if (nightsNow === 0) {
    const meal = LOCAL_ONLY.test(text);
    const needs = trip.needs.filter((n) => n !== "stay");
    // A day out is more than a meal, unless a meal is all they asked for.
    if (!meal && !needs.includes("activities")) needs.push("activities");
    return { ...trip, startDate: start, endDate: start, needs: needs.length ? needs : ["dine"], assumptions: [...assumptions, meal ? "Just the one outing, so no hotel" : "A day trip, so no hotel"] };
  }
  const needs = trip.needs.includes("stay") ? trip.needs : (["stay", ...trip.needs] as TripRequest["needs"]);
  return { ...trip, startDate: start, endDate: end, needs, assumptions };
}
