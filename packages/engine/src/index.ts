export * from "./types";
export * from "./errors";
export { QlooClient } from "./clients/qloo";
export type { QlooEntity, QlooTag, InsightType, InsightParams, DemographicsRow, HeatPoint } from "./clients/qloo";
export { LlmClient, extractJson } from "./clients/llm";
export type { ModelTier } from "./clients/llm";
export { TavilyClient } from "./clients/tavily";
export type { WebResult, WebSearch, ProviderCall } from "./clients/web";
export { WikiSearchClient } from "./clients/wiki";
export { ChainedWebSearch } from "./clients/chain";
export { ClaudeSearchClient, ClaudeReader } from "./clients/claude-search";
export type { HotelRate } from "./clients/claude-search";
export { normalizeLocation, broadeningLadder, distanceKm, findPlaces } from "./location";
export type { PlaceSearch } from "./location";
export { runBrief, validateGraph } from "./orchestrator";
export type { BriefEvent, BriefRun, StepStatus, RunOptions } from "./orchestrator";
export { FactSheet } from "./grounding";
export { answerFollowUp, factsFromResults } from "./followup";
export type { FollowUp } from "./followup";
export {
  ALL_SKILLS,
  MISSIONS,
  MISSION_TYPES,
  missionSkills,
  missionSteps,
  pendingCheckpoints,
  checkpointOptions,
  sanitizeSelections,
  planGoal,
  keywordPlan,
  guessArtist,
  splitVersus,
} from "./missions";
export type { MissionType, MissionDef, Checkpoint, CheckpointOption, Autonomy, Plan, GoalParts } from "./missions";
export type { FansSegmentsOutput, CompareArtistsOutput, CompareBrandsOutput } from "./skills/compare";
export type { BrandMatchesOutput, BrandMatch } from "./skills/brand-matches";
export type { BrandResearchOutput } from "./skills/brand-research";
export type { BrandPitchesOutput } from "./skills/brand-pitches";
export type { TourCitiesOutput, TourVenuesOutput, TourRouteOutput, TourExperiencesOutput } from "./skills/tour";
export type { GrowthCollaboratorsOutput, GrowthMarketsOutput, GrowthPressOutput } from "./skills/growth";
export type { ContentAnglesOutput, ContentAdsOutput, ContentMerchOutput, ContentReleaseOutput } from "./skills/content";
export { createContext, readEnv, createUsageMeter, consoleLogger, capabilities } from "./context";
export { normalizeTrip } from "./missions";
export { tidyTranscript, keepsNumbers } from "./tidy";
export { cleanProfile, extractProfile, profileSchema, EXPORT_PROMPT } from "./profile";
export { ResendSender, EMAIL_RE } from "./clients/email";
export type { EmailSender, OutgoingEmail } from "./clients/email";
export { VapiCaller, toE164, E164_RE } from "./clients/calls";
export type { CallPlacer, CallStatus } from "./clients/calls";
export type { TripFlightsOutput } from "./skills/flights";
export { DuffelClient } from "./clients/duffel";
export { UberClient, cheapestFare } from "./clients/uber";
export { LiteApiProvider } from "./clients/liteapi";
export { tripDates, bookingLink, mapsLink, cityLabel, ACTION_LIMITS } from "./skills/trip";
export type { Place, TasteOutput, TripPlanOutput, TripAction, TripActionsOutput, TripExecuteOutput, ActionResult } from "./skills/trip";
export type { TripAgentOutput, GeoPoint, Stop, Fact } from "./skills/trip-agent";
export type { TripRoutesOutput } from "./skills/trip-routes";
export type { PlaceKind } from "./skills/places";
export { describeTrip, updateTrip, blankTrip } from "./trip-request";
export { OsmClient, decodePolyline, simplifyPath, spellingVariants } from "./clients/osm";
export type { GeoHit, OsmPlace, Route, RouteMode } from "./clients/osm";
export type { HotelProvider, HotelOffer, HotelSearch, HeldRate, Booking, GuestDetails } from "./clients/hotels";
export { runAgent, modelPolicy, normalizeDecision, defineTool } from "./agent/runtime";
export type { AgentRun, AgentLimits, ToolSpec, Policy, Decision, Turn } from "./agent/runtime";
export { documentsBlock, searchDocuments, cleanDocText, readDocument, sniffKind, MAX_DOC_BYTES, MAX_DOC_CHARS } from "./documents";
export type { DocumentReader, RawFile, DocKind } from "./documents";
export { groundTrip, mentionsNumber } from "./trip-request";
export type { DecisionLog, FallbackReason } from "./agent/runtime";
export { neededKinds, niceKinds, arrivalMode } from "./skills/trip-agent";
export { tierHotels, scoreHotels, parsePrice, hotelQuality, TIER_IDS } from "./skills/hotel-tiers";
export type { HotelTier, HotelScore, PriceEstimate, TierId } from "./skills/hotel-tiers";
export { rideFare, rideLinks, WALK_KM } from "./skills/rides";
export type { RideEstimate } from "./skills/rides";
export type { LlmCallRecord } from "./clients/llm";

import { artistResolve } from "./skills/artist-resolve";
import { fansProfile } from "./skills/fans-profile";
import { fansDna } from "./skills/fans-dna";
import { fansDemographics } from "./skills/fans-demographics";
import type { BriefInput, Skill } from "./types";

export { artistResolve, fansProfile, fansDna, fansDemographics };
export { normalizeArtistName } from "./skills/artist-resolve";
export type { ArtistResolveOutput } from "./skills/artist-resolve";
export type { FansProfileOutput } from "./skills/fans-profile";
export type { FansDnaOutput } from "./skills/fans-dna";
export type { FansDemographicsOutput } from "./skills/fans-demographics";

/** Skills that run in a brief, in display order. Grows as each milestone lands. */
export const BRIEF_SKILLS: Skill<BriefInput, unknown>[] = [
  artistResolve as Skill<BriefInput, unknown>,
  fansProfile as Skill<BriefInput, unknown>,
  fansDna as Skill<BriefInput, unknown>,
  fansDemographics as Skill<BriefInput, unknown>,
];
export { readTags, ageLean, tasteZone, heatForMap, tasteHit, type TasteZone } from "./skills/taste";
export { withMatch } from "./skills/places";
export { likesIn } from "./missions";
export { areaName } from "./clients/osm";
