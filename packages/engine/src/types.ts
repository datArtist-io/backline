import type { z } from "zod";
import type { QlooClient } from "./clients/qloo";
import type { LlmClient } from "./clients/llm";
import type { WebSearch } from "./clients/web";
import type { EmailSender } from "./clients/email";
import type { CallPlacer } from "./clients/calls";
import type { OsmClient } from "./clients/osm";
import type { HotelProvider } from "./clients/hotels";
import type { DuffelClient } from "./clients/duffel";

/** Where a recommendation came from. Every recommendation must carry at least one. */
export type Evidence =
  | {
      source: "qloo";
      entityId: string;
      label: string;
      affinity?: number;
      /** Short human-readable description of the query that produced it, e.g. "brands · fans of Tems". */
      query: string;
    }
  | {
      source: "web";
      url: string;
      title: string;
      retrievedAt: string;
    }
  | {
      source: "derived";
      /** For values computed from other evidence (e.g. a route distance). */
      label: string;
      basis: string;
    };

export type Logger = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

export type UsageMeter = {
  add: (kind: "qloo" | "llm_tokens" | "web" | "maps" | "hotels" | "flights", units: number) => void;
  snapshot: () => Record<string, number>;
};

/**
 * One visible moment of a skill's work, streamed to the user while it runs: the agent saying
 * what it's doing ("think"), starting a tool ("act"), what the tool found ("saw"), or an aside.
 */
export type StepProgress = {
  kind: "think" | "act" | "saw" | "note";
  text: string;
  /** Pairs an "act" with its "saw". */
  id?: string;
  tool?: string;
  ok?: boolean;
  ms?: number;
  turn?: number;
  /** Who decided this step: the model, or the scripted autopilot that takes over if it stalls. */
  by?: "model" | "autopilot";
};

export type SkillContext = {
  qloo: QlooClient;
  llm: LlmClient | null;
  /** Live web research, or null when no provider is configured. */
  web: WebSearch | null;
  /** Sends emails on the user's behalf after approval, or null when not configured. */
  email?: EmailSender | null;
  /** Places AI phone calls on the user's behalf after approval, or null when not configured. */
  calls?: CallPlacer | null;
  /** OpenStreetMap geocoding and nearby places (no key needed), or null when turned off. */
  osm?: OsmClient | null;
  /** Live hotel availability and reservations, or null when no booking provider is connected. */
  hotels?: HotelProvider | null;
  /** Flight search and booking, or null when no flight provider is connected. */
  flights?: DuffelClient | null;
  /** Looks up a hotel's listed nightly price for the trip, with its source page (Claude web search). */
  rates?: { hotelRate(q: { name: string; city: string; checkin: string | null; checkout: string | null; adults: number; currency: string }, signal?: AbortSignal): Promise<{ perNight: number; currency: string; total: number | null; url: string; site: string; note: string | null } | null> } | null;
  /** Streams what a running skill is doing. Set by the orchestrator for each skill. */
  progress?: (p: StepProgress) => void;
  log: Logger;
  usage: UsageMeter;
  signal?: AbortSignal;
};

export type SkillResult<O> = { data: O; evidence: Evidence[]; notes?: string[] };

export type SkillId =
  | "artist.resolve"
  | "fans.profile"
  | "fans.dna"
  | "fans.demographics"
  | "brand.matches"
  | "brand.research"
  | "brand.pitches"
  | "tour.cities"
  | "tour.venues"
  | "tour.route"
  | "tour.experiences"
  | "growth.collaborators"
  | "growth.markets"
  | "growth.press"
  | "content.angles"
  | "content.ads"
  | "content.merch"
  | "content.release"
  | "trip.taste"
  | "trip.flights"
  | "trip.agent"
  | "trip.plan"
  | "trip.routes"
  | "trip.actions"
  | "trip.execute"
  | "fans.segments"
  | "compare.artists"
  | "compare.brands"
  | (string & {});

/**
 * A skill is one unit of agent work. `run` receives the brief input plus the outputs of
 * the skills it depends on, keyed by skill id.
 */
export type Skill<I = unknown, O = unknown> = {
  id: SkillId;
  title: string;
  dependsOn: SkillId[];
  /** Skills whose output is used when available; a failure there doesn't block this skill. */
  optionalDeps?: SkillId[];
  /** Per-skill time budget. */
  timeoutMs: number;
  /** Validates the skill's own output before it's accepted. */
  output: z.ZodType<O>;
  run: (ctx: SkillContext, input: I, deps: Record<string, SkillResult<unknown>>) => Promise<SkillResult<O>>;
};

/** The input a whole brief or mission starts from. */
export type BriefInput = {
  artist: string;
  /** Optional focus location: any city, region or country, in any language. */
  location?: string;
  /** Optional focus within the goal, e.g. a brand category ("sportswear") or a release name. */
  focus?: string;
  /** Language the user wrote in (English name, e.g. "French"). Written outputs use it. */
  language?: string;
  /** Another artist to compare against (rival comparison). */
  compareWith?: string;
  /** Two brands to weigh against each other for this artist (head-to-head). */
  compareBrands?: string[];
  /** A trip or event to plan (the "plan" mission). */
  trip?: TripRequest;
  /** The user's request in their own words, so the agent can re-read it rather than rely on a summary. */
  request?: string;
  /** The user's local date (YYYY-MM-DD), so "the 28th" and "next weekend" mean their dates. */
  today?: string;
  /** Files the user attached (already turned into text). Treated as data, never as instructions. */
  documents?: DocumentText[];
  /** What the agent knows about the user: preferences, tastes and contact details. */
  profile?: Profile;
  /** Choices made at checkpoints, keyed by checkpoint id (e.g. { brands: ["id1","id2"] }). */
  selections?: Record<string, string[]>;
};

/** An attached file, read into plain text. */
export type DocumentText = {
  name: string;
  text: string;
  /** "pdf", "docx", "image"… shown to the user and the agent. */
  kind?: string;
  /** True when the text was cut to fit. */
  truncated?: boolean;
};

/** What the agent knows about the person it works for. Everything is optional. */
export type Profile = {
  name?: string;
  email?: string;
  phone?: string;
  homeCity?: string;
  /** For booking flights: date of birth (YYYY-MM-DD) and gender as on their passport. */
  birthDate?: string;
  gender?: "m" | "f";
  currency?: string;
  budgetStyle?: "budget" | "mid" | "luxury";
  dietary?: string[];
  /** Things they love: artists, films, shows, books, cuisines, brands. Used as taste signals. */
  likes?: string[];
  stayPrefs?: string[];
  notes?: string;
};

export type TripRequest = {
  destination: string;
  /** ISO dates (YYYY-MM-DD), when known. */
  startDate: string | null;
  endDate: string | null;
  adults: number;
  rooms: number;
  budget: { amount: number | null; currency: string; scope: "total" | "per_night" | null };
  /** 1 (cheapest) to 4 (most expensive), the agent's read of the budget for this place. */
  priceTier: number | null;
  purpose: string | null;
  /** An event to host, if any (birthday dinner, launch party, show). */
  event: { type: string; guests: number | null; date: string | null } | null;
  needs: ("stay" | "dine" | "venue" | "activities")[];
  /** A landmark to stay or eat close to ("National Theatre"), within the destination. */
  near: string | null;
  /** Where they're travelling from, if said ("from Abuja"); otherwise their home city is used. */
  origin?: string | null;
  /** How they're getting there, if said ("train", "flight", "car"). */
  travelMode: string | null;
  /** Things the user handles themselves (e.g. "transport"). The agent plans around them but doesn't book them. */
  selfArranged: string[];
  /** A person whose taste the plan should follow ("like Burna Boy would"). */
  inspiredBy?: string | null;
  /** Things they said they love in the request (artists, films, cuisines). Read as taste through Qloo. */
  likes?: string[];
  /** Things the agent assumed because the request didn't say. Shown to the user. */
  assumptions: string[];
};
