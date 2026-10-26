"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  MissionType,
  Plan,
  TourCitiesOutput,
  TourExperiencesOutput,
  TourRouteOutput,
  TourVenuesOutput,
  FansSegmentsOutput,
  CompareArtistsOutput,
  CompareBrandsOutput,
  DocumentText,
  Place,
  Profile,
  StepProgress,
  TripActionsOutput,
  TripAgentOutput,
  TripExecuteOutput,
  TripPlanOutput,
  TripRoutesOutput,
  TasteOutput,
  TripFlightsOutput,
  TripIntelOutput,
  TripTravelOutput,
} from "@backline/engine";
import { ActionsCheckpoint, AgentSummary, PlacesSection, PlanSection, ResultsSection, tripChips } from "./trip";
import AgentActivity from "./AgentActivity";
import TasteCard from "./Taste";
import AgentTrace from "./AgentTrace";
import FlightCard from "./FlightCard";
import TripMap, { type TasteLayer } from "./TripMap";
import AdventureView from "../adventure/AdventureView";
import Codex from "../adventure/Codex";
import { buildAdventure } from "../adventure/model";
import HotelLanes from "./HotelLanes";
import Preferences from "./Preferences";
import AccountButton from "../AccountButton";
import { useMe } from "@/lib/auth-client";
import { loadDocs } from "@/lib/docs";
import { loadProfile, saveProfile, today } from "@/lib/profile";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";
import { streamMission, type CheckpointRequest, type MissionDebug, type MissionRequest, type Planned, type StepResult, type StepState } from "@/lib/mission-stream";
import DebugPanel from "./DebugPanel";
import { buildReport } from "@/lib/report";
import { downloadFile, slug } from "@/lib/actions";
import { rememberArtist, rememberedArtist } from "@/lib/memory";
import { useRouter } from "next/navigation";
import FollowUp from "./FollowUp";
import ModeSwitch from "../ModeSwitch";
import { ArtistHeader, DemographicsSection, DnaSection, HeaderSkeleton, Placeholder, ProfileSection } from "./sections";
import {
  BrandMatchesSection,
  CheckpointPanel,
  CitiesSection,
  CompareArtistsSection,
  CompareBrandsSection,
  ContentSection,
  GrowthSection,
  OnePager,
  PitchesSection,
  SegmentsSection,
  TourSection,
} from "./deliverables";

type Status = "planning" | "running" | "waiting" | "done" | "error" | "needs" | "reply";
type Autonomy = "check" | "auto";

const LABELS: Record<MissionType, string> = { plan: "Plan and book", brand_deal: "Brand deal", tour: "Tour", grow: "Growth", content: "Content", compare: "Compare", brief: "Full strategy" };

export default function MissionView(props: { goal?: string; artist?: string; mission?: MissionType; autonomy: Autonomy; docs?: string; debug?: boolean }) {
  const [autonomy, setAutonomy] = useState<Autonomy>(props.autonomy);
  const [debugInfo, setDebugInfo] = useState<MissionDebug | null>(null);
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [activity, setActivity] = useState<Record<string, StepProgress[]>>({});
  const docsRef = useRef<DocumentText[] | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointRequest[]>([]);
  const [status, setStatus] = useState<Status>("planning");
  const [error, setError] = useState<string | null>(null);
  const [needs, setNeeds] = useState<{ field: string; message: string; plan: Plan; preview: string[] } | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [reply, setReply] = useState<{ message: string; suggestions: string[] } | null>(null);
  const [workingFor, setWorkingFor] = useState<string | null>(null);
  const router = useRouter();
  const { me, ready: meReady, configured: signInOn } = useMe();
  const [printPitch, setPrintPitch] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const plannedRef = useRef<Planned | null>(null);
  // Set when the person taps "Run again", so a repeat request books again on purpose and only then.
  const rebookRef = useRef(false);

  const start = useCallback((req: MissionRequest, keepResults = false) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setError(null);
    setNeeds(null);
    setReply(null);
    setCheckpoints([]);
    setStatus(keepResults ? "running" : "planning");
    if (!keepResults) {
      setResults({});
      setSteps([]);
      setPlanned(null);
      setActivity({});
      setDebugInfo(null);
    }
    const remembered = rememberedArtist();
    setWorkingFor(remembered);
    streamMission(
      // The remembered artist only matters for music missions; the server ignores it for trips.
      {
        ...req,
        defaultArtist: req.artist || req.mission === "plan" ? undefined : (remembered ?? undefined),
        profile: req.profile ?? loadProfile(),
        today: today(),
        documents: docsRef.current?.length ? docsRef.current : undefined,
        debug: props.debug || undefined,
      },
      {
        onPlanned: (p) => {
          plannedRef.current = p;
          setPlanned(p);
          setStatus("running");
          setSteps((prev) => p.steps.map((s) => ({ id: s.id, title: s.title, status: "pending", checkpoint: s.checkpoint, ...(keepResults ? prev.find((x) => x.id === s.id) : undefined) })));
        },
        onStep: (id, patch, result) => {
          setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
          if (result) setResults((prev) => ({ ...prev, [id]: result }));
        },
        onProgress: (id, p) => setActivity((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), p].slice(-150) })),
        onCheckpoint: (cp) => setCheckpoints((prev) => [...prev.filter((x) => x.id !== cp.id), cp]),
        onNeeds: (field, message, plan, preview) => {
          setNeeds({ field, message, plan, preview });
          setStatus("needs");
        },
        onReply: (message, suggestions) => {
          setReply({ message, suggestions });
          setStatus("reply");
        },
        onDone: (s) => setStatus(s === "waiting" ? "waiting" : "done"),
        onError: (msg) => {
          setError(msg);
          setStatus("error");
        },
        onDebug: setDebugInfo,
      },
      c.signal
    );
  }, [props.debug]);

  useEffect(() => {
    docsRef.current = loadDocs(props.docs);
    start({ goal: props.goal, artist: props.artist, mission: props.mission, autonomy: props.autonomy });
    return () => ctrl.current?.abort();
  }, [start, props.goal, props.artist, props.mission, props.autonomy, props.docs]);

  const resume = (cpId: string, ids: string[], profile?: Profile) => {
    const p = plannedRef.current;
    if (!p) return;
    if (profile) saveProfile(profile);
    start(
      {
        profile,
        runId: p.runId,
        rebook: rebookRef.current || undefined,
        goal: p.plan.goal,
        mission: p.plan.mission,
        artist: p.plan.artist ?? undefined,
        location: p.plan.location ?? undefined,
        autonomy,
        selections: { [cpId]: ids },
      },
      true
    );
  };

  const rerun = (mode: Autonomy = autonomy) => {
    const p = plannedRef.current?.plan;
    rebookRef.current = true;
    start({ goal: p?.goal ?? props.goal, artist: p?.artist ?? props.artist, mission: p?.mission ?? props.mission, location: p?.location ?? undefined, autonomy: mode, rebook: true });
  };

  const onOnePager = (brandId: string) => {
    setPrintPitch(brandId);
    document.body.classList.add("print-one");
    const done = () => {
      document.body.classList.remove("print-one");
      setPrintPitch(null);
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 60);
  };

  const r = <T,>(id: string) => results[id] as (StepResult & { data: T }) | undefined;
  const resolved = r<ArtistResolveOutput>("artist.resolve");
  const artistName = resolved?.data.artist.name ?? planned?.plan.artist ?? props.artist ?? "";
  const mission = planned?.plan.mission ?? props.mission;
  const resolveStep = steps.find((s) => s.id === "artist.resolve");
  const has = (id: string) => steps.some((s) => s.id === id);
  const running = status === "planning" || status === "running";
  const done = status === "done" || status === "waiting";
  const pitches = r<BrandPitchesOutput>("brand.pitches");
  const pitchToPrint = printPitch ? pitches?.data.pitches.find((p) => p.brandId === printPitch) : undefined;
  const agentOut = r<TripAgentOutput>("trip.agent")?.data;
  // Once the agent has corrected or completed the trip, show its version.
  const shownTrip = agentOut?.trip ?? planned?.plan.trip ?? null;
  const docNames = (docsRef.current ?? []).map((d) => d.name);

  const altHref = (name: string) => `/mission?${new URLSearchParams({ artist: name, ...(mission ? { m: mission } : {}), mode: autonomy, ...(planned?.plan.goal ? { goal: planned.plan.goal.replace(artistName, name) } : {}) })}`;

  return (
    <>
      <div className="brief">
        <header className="brief-top">
          <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
            <Logo />
          </Link>
          <div className="top-acts">
            <AccountButton />
            <button type="button" className="lg pill" onClick={() => setPrefsOpen(true)}>
              Preferences
            </button>
            <Link href="/" className="lg pill">
              New mission
            </Link>
          </div>
        </header>

        <div className="brief-grid">
          <aside className="lg rail" aria-label="Agent progress">
            <p className="rail-eyebrow">{mission ? LABELS[mission] : "Mission"}</p>
            <p className="rail-title">
              {status === "planning" ? "Planning" : running ? "Working on it" : status === "waiting" ? "Needs your call" : status === "done" ? "Done" : status === "needs" ? "One question" : status === "reply" ? "Replied" : "Stopped"}
            </p>
            {workingFor && mission !== "plan" && (
              <p className="working-for">
                Working for <strong>{workingFor}</strong>{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    rememberArtist(null);
                    setWorkingFor(null);
                    const p = plannedRef.current?.plan;
                    start({ goal: p?.goal ?? props.goal, mission: p?.mission ?? props.mission, location: p?.location ?? undefined, autonomy });
                  }}
                >
                  Change
                </button>
              </p>
            )}
            <ol className="steps">
              {steps.length === 0 && running && (
                <li className="step is-running">
                  <span className="step-dot" aria-hidden="true" />
                  <span className="step-body">
                    <span className="step-title">Reading your goal</span>
                  </span>
                </li>
              )}
              {steps.map((s) => (
                <li key={s.id} className={`step is-${s.status}${s.checkpoint ? " has-cp" : ""}`}>
                  <span className="step-dot" aria-hidden="true" />
                  <span className="step-body">
                    {s.checkpoint && s.status === "waiting" && <span className="step-cp">Your call first</span>}
                    <span className="step-title">{s.title}</span>
                    {s.status === "succeeded" && s.ms != null && <span className="step-meta">{s.cached ? "done" : `${(s.ms / 1000).toFixed(1)}s`}</span>}
                    {(s.status === "failed" || s.status === "skipped") && s.error && <span className="step-meta">{s.error}</span>}
                  </span>
                  <span className="sr-only">{s.status}</span>
                </li>
              ))}
            </ol>
            <ModeSwitch value={autonomy} onChange={setAutonomy} className="rail-switch" />
            {!running && (
              <button type="button" className="rerun" onClick={() => rerun()}>
                Run again
              </button>
            )}
          </aside>

          <main className="brief-main">
            <section className="mission-head">
              <p className="eyebrow">{planned ? "Mission" : "You asked"}</p>
              <h1 key={planned ? "planned" : "asked"} className={`mission-goal${planned ? "" : " is-asked"}`}>
                {planned ? planned.goal : `“${props.goal ?? props.artist ?? ""}”`}
              </h1>
              {planned?.ack && (
                <p className="agent-says">
                  <span className="agent-dot" aria-hidden="true" />
                  {planned.ack}
                </p>
              )}
              {status === "planning" && (
                <p className="agent-says is-thinking">
                  <span className="agent-dot" aria-hidden="true" />
                  Reading your goal and planning the steps
                </p>
              )}
              {planned && shownTrip && (
                <ul className="mission-chips">
                  {(shownTrip.destination ? tripChips(shownTrip, agentOut?.where) : ["Reading your document"]).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                  {docNames.map((n) => (
                    <li key={n} className="chip-doc">
                      {n}
                    </li>
                  ))}
                  <li>{planned.autonomy === "check" ? "Checks with you" : "Runs end to end"}</li>
                </ul>
              )}
              {shownTrip && shownTrip.assumptions.length > 0 && (
                <p className="assumed">
                  I assumed: {shownTrip.assumptions.join(". ")}. Change anything by asking again.
                </p>
              )}
              {planned && !planned.plan.trip && (
                <ul className="mission-chips">
                  {planned.plan.location && <li>{planned.plan.location}</li>}
                  {planned.plan.focus && <li>{planned.plan.focus}</li>}
                  {planned.plan.language !== "English" && <li>Writing in {planned.plan.language}</li>}
                  <li>{planned.autonomy === "check" ? "Checks with you" : "Runs end to end"}</li>
                </ul>
              )}
              {done && Object.keys(results).length > 1 && (
                <div className="acts">
                  <button type="button" className="act" onClick={() => downloadFile(`${slug(planned?.goal ?? artistName)}.md`, buildReport(planned?.goal ?? artistName, results))}>
                    Download report
                  </button>
                  <button type="button" className="act" onClick={() => window.print()}>
                    Save as PDF
                  </button>
                </div>
              )}
            </section>

            {error && (
              <div className="lg notice" role="alert">
                <p>{error}</p>
                <button type="button" className="rerun" onClick={() => rerun()}>
                  Try again
                </button>
              </div>
            )}

            {done && mission === "plan" && meReady && signInOn && !me && (
              <div className="lg notice" role="status">
                <p>Sign in and I&rsquo;ll book, pay, email and call for you. Until then, everything here opens in your own apps.</p>
                <Link href={`/signin?next=${encodeURIComponent(`/mission?${new URLSearchParams({ ...(props.goal ? { goal: props.goal } : {}), mode: "check" })}`)}`} className="rerun">
                  Sign in
                </Link>
              </div>
            )}

            {needs && (
              <NeedsArtist
                plan={needs.plan}
                message={needs.message}
                preview={needs.preview}
                placeholder={needs.field === "destination" ? "Lisbon, 3 nights from Friday, 4 people" : "Artist or stage name"}
                onSubmit={(answer) => {
                  if (needs.field === "destination") {
                    start({ goal: `${needs.plan.goal}. ${answer}`, mission: "plan", autonomy });
                    return;
                  }
                  rememberArtist(answer);
                  start({ goal: needs.plan.goal, artist: answer, mission: needs.plan.mission, location: needs.plan.location ?? undefined, autonomy });
                }}
              />
            )}

            {reply && (
              <section className="lg agent-card" aria-live="polite">
                <p className="agent-says">
                  <span className="agent-dot" aria-hidden="true" />
                  {reply.message}
                </p>
                {reply.suggestions.length > 0 && (
                  <div className="suggestions">
                    {reply.suggestions.map((sg) => (
                      <button key={sg} type="button" className="suggestion" onClick={() => router.push(`/mission?${new URLSearchParams({ goal: sg, mode: autonomy })}`)}>
                        {sg}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {resolveStep?.status === "failed" && (
              <div className="lg notice" role="alert">
                <p>{resolveStep.error}</p>
                <Link href="/" className="rerun">
                  Try another name
                </Link>
              </div>
            )}

            {resolved ? <ArtistHeader data={resolved.data} altHref={altHref} /> : planned && mission !== "plan" && resolveStep?.status !== "failed" ? <HeaderSkeleton name={artistName} /> : null}

            {checkpoints.map((cp) =>
              cp.id === "actions" && r<TripActionsOutput>("trip.actions") ? (
                <ActionsCheckpoint
                  key={cp.id + (planned?.runId ?? "")}
                  actions={r<TripActionsOutput>("trip.actions")!.data.actions}
                  profile={loadProfile()}
                  busy={running}
                  onConfirm={(ids, profile) => resume(cp.id, ids, profile)}
                />
              ) : (
                <CheckpointPanel key={cp.id + (planned?.runId ?? "")} request={cp} busy={running} onConfirm={(ids) => resume(cp.id, ids)} />
              )
            )}

            {props.debug && <DebugPanel debug={debugInfo} results={results} steps={steps} />}
            {mission === "plan" && <TripView r={r} steps={steps} title={planned?.goal ?? ""} activity={activity["trip.agent"] ?? []} onEditTaste={() => setPrefsOpen(true)} />}

            {/* Deliverables first: what the mission set out to produce. */}
            {mission === "brand_deal" && (
              <>
                {pitches ? <PitchesSection result={pitches} artistName={artistName} onOnePager={onOnePager} /> : has("brand.pitches") && steps.find((s) => s.id === "brand.pitches")?.status !== "waiting" && <Placeholder steps={steps} id="brand.pitches" label="Pitches" />}
                {r<BrandMatchesOutput>("brand.matches") ? (
                  <BrandMatchesSection result={r<BrandMatchesOutput>("brand.matches")!} research={r<BrandResearchOutput>("brand.research")} />
                ) : (
                  has("brand.matches") && <Placeholder steps={steps} id="brand.matches" label="Brands the fans already love" />
                )}
              </>
            )}

            {mission === "tour" && (
              <>
                <TourSection artistName={artistName} route={r<TourRouteOutput>("tour.route")} venues={r<TourVenuesOutput>("tour.venues")} experiences={r<TourExperiencesOutput>("tour.experiences")} />
                {!r("tour.route") && has("tour.route") && steps.find((s) => s.id === "tour.route")?.status !== "waiting" && <Placeholder steps={steps} id="tour.route" label="The route" />}
                {r<TourCitiesOutput>("tour.cities") ? <CitiesSection result={r<TourCitiesOutput>("tour.cities")!} /> : has("tour.cities") && <Placeholder steps={steps} id="tour.cities" label="Where the taste is strongest" />}
              </>
            )}

            {(mission === "grow" || mission === "brief") && (
              <>
                <GrowthSection collabs={r<GrowthCollaboratorsOutput>("growth.collaborators")} markets={r<GrowthMarketsOutput>("growth.markets")} press={r<GrowthPressOutput>("growth.press")} />
                {!r("growth.collaborators") && has("growth.collaborators") && <Placeholder steps={steps} id="growth.collaborators" label="Collaborators" />}
              </>
            )}

            {(mission === "content" || mission === "brief") && (
              <>
                <ContentSection angles={r<ContentAnglesOutput>("content.angles")} ads={r<ContentAdsOutput>("content.ads")} merch={r<ContentMerchOutput>("content.merch")} release={r<ContentReleaseOutput>("content.release")} />
                {!r("content.angles") && has("content.angles") && <Placeholder steps={steps} id="content.angles" label="Content angles" />}
              </>
            )}

            {mission === "compare" && (
              <>
                {r<CompareBrandsOutput>("compare.brands") && <CompareBrandsSection result={r<CompareBrandsOutput>("compare.brands")!} />}
                {r<CompareArtistsOutput>("compare.artists") && <CompareArtistsSection result={r<CompareArtistsOutput>("compare.artists")!} artistName={artistName} />}
                {!r("compare.artists") && has("compare.artists") && <Placeholder steps={steps} id="compare.artists" label="Comparison" />}
              </>
            )}

            {(mission === "compare" || mission === "content" || mission === "brief") && r<FansSegmentsOutput>("fans.segments") && <SegmentsSection result={r<FansSegmentsOutput>("fans.segments")!} />}

            {mission === "brief" && (
              <>
                {r<BrandMatchesOutput>("brand.matches") && <BrandMatchesSection result={r<BrandMatchesOutput>("brand.matches")!} />}
                {r<TourCitiesOutput>("tour.cities") && <CitiesSection result={r<TourCitiesOutput>("tour.cities")!} />}
              </>
            )}

            {status === "done" && planned && resolved && <FollowUp runId={planned.runId} artist={artistName} autonomy={autonomy} />}

            {/* What the agent learned on the way. */}
            {planned && mission !== "plan" && resolveStep?.status !== "failed" && (
              <>
                <div className="divider">
                  <span>What the agent learned about the fans</span>
                </div>
                {r<FansDnaOutput>("fans.dna") ? <DnaSection result={r<FansDnaOutput>("fans.dna")!} /> : <Placeholder steps={steps} id="fans.dna" label="Fan DNA" />}
                {r<FansDemographicsOutput>("fans.demographics") ? <DemographicsSection result={r<FansDemographicsOutput>("fans.demographics")!} /> : <Placeholder steps={steps} id="fans.demographics" label="Who the fans are" />}
                {r<FansProfileOutput>("fans.profile") ? <ProfileSection result={r<FansProfileOutput>("fans.profile")!} artistName={artistName} /> : <Placeholder steps={steps} id="fans.profile" label="What the fans love" />}
              </>
            )}
          </main>
        </div>
      </div>
      <div className="print-root" aria-hidden="true">
        {pitchToPrint && <OnePager pitch={pitchToPrint} artistName={artistName} matches={r<BrandMatchesOutput>("brand.matches")?.data} />}
      </div>
      <Preferences open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </>
  );
}

/** Every place the plan can point at, including stops like the landmark, by id. */
function placeMap(a?: TripAgentOutput): Map<string, Place> {
  const m = new Map<string, Place>();
  if (!a) return m;
  for (const p of [...a.stays, ...a.dines, ...a.venues, ...a.activities]) m.set(p.id, p);
  for (const s of a.stops)
    m.set(s.id, { id: s.id, name: s.name, address: null, phone: null, email: null, website: null, priceLevel: null, rating: null, affinity: null, image: null, lat: s.lat, lon: s.lon, tags: [], fit: 0, why: [], priceNote: null, extra: null, sources: [] });
  return m;
}

/** Before routes are ready: the picked places and stops (and the closest alternatives), so the map shows straight away. */
function pointsOnly(a: TripAgentOutput): TripRoutesOutput {
  const picked = new Set([...a.picks.stays, ...a.picks.dines, ...a.picks.venues, ...a.picks.activities]);
  const points = [
    ...[...a.stays, ...a.dines, ...a.venues, ...a.activities].flatMap((p) => (p.lat != null && p.lon != null ? [{ id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind: p.kind ?? "place", picked: picked.has(p.id) }] : [])),
    ...a.stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, kind: s.kind === "landmark" ? "landmark" : "stop", picked: true })),
  ];
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return { days: [], points, bounds: points.length ? [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)] : null, provider: "none" };
}

/** The planning mission: the agent at work, what was done, what it found, the map, the plan, the places. */
function TripView({
  r,
  steps,
  title,
  activity,
  onEditTaste,
}: {
  r: <T>(id: string) => (StepResult & { data: T }) | undefined;
  steps: StepState[];
  title: string;
  activity: StepProgress[];
  onEditTaste: () => void;
}) {
  const taste = r<TasteOutput>("trip.taste")?.data;
  const tasteLayer = useMemo<TasteLayer | null>(() => (taste && taste.heat.length ? { heat: taste.heat, zone: taste.zone } : null), [taste]);
  const showMap = () => document.querySelector(".trip-map")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const agent = r<TripAgentOutput>("trip.agent");
  const plan = r<TripPlanOutput>("trip.plan");
  const routes = r<TripRoutesOutput>("trip.routes");
  const actions = r<TripActionsOutput>("trip.actions");
  const exec = r<TripExecuteOutput>("trip.execute");
  const a = agent?.data;
  const places = useMemo(() => placeMap(a), [a]);
  const mapData = useMemo(() => routes?.data ?? (a ? pointsOnly(a) : null), [routes, a]);
  const agentStep = steps.find((s) => s.id === "trip.agent");
  const intel = r<TripIntelOutput>("trip.intel")?.data ?? null;
  const intelStep = steps.find((s) => s.id === "trip.intel");
  const travel = r<TripTravelOutput>("trip.travel")?.data ?? null;
  const [view, setView] = useState<"map" | "classic">("map");
  const adventure = useMemo(() => buildAdventure({ title, agent: a, plan: plan?.data, routes: routes?.data, taste, intel, travel }), [title, a, plan, routes, taste, intel, travel]);
  const working = steps.some((s) => s.id.startsWith("trip.") && (s.status === "pending" || s.status === "running"));
  const anchor = a?.where.landmark?.name ?? a?.where.zone?.name ?? a?.where.city?.name ?? null;
  const landmarkId = a?.stops.find((s) => s.kind === "landmark")?.id ?? (a?.where.landmark ? a.stops[0]?.id : null) ?? null;
  return (
    <>
      <div className="adv-wrap">
        <div className="adv-switch" role="group" aria-label="View">
          <button type="button" className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Adventure map</button>
          <button type="button" className={view === "classic" ? "on" : ""} onClick={() => setView("classic")}>Classic view</button>
        </div>
        {view === "map" && <AdventureView model={adventure} steps={steps} activity={activity} scanning={working && !plan} intelPending={intelStep?.status === "running" || intelStep?.status === "pending"} onClassic={() => setView("classic")} />}
      </div>
      {view === "classic" && taste && <TasteCard taste={taste} onEdit={onEditTaste} onShowMap={mapData?.bounds ? showMap : undefined} />}
      {view === "map" && taste && <button type="button" className="link-btn" onClick={onEditTaste}>Edit your taste</button>}
      <AgentActivity entries={activity} running={agentStep?.status === "running" || agentStep?.status === "pending"} />
      {exec && actions && <ResultsSection title={title} actions={actions.data} execute={exec} plan={plan?.data} places={places} />}
      {agent ? <AgentSummary result={agent} /> : (agentStep?.status === "failed" || agentStep?.status === "skipped") && <Placeholder steps={steps} id="trip.agent" label="What I found" />}
      {a && <AgentTrace agent={a} />}
      {r<TripFlightsOutput>("trip.flights")?.data.flight && (
        <FlightCard
          data={r<TripFlightsOutput>("trip.flights")!.data}
          booked={(() => {
            const act = actions?.data.actions.find((x) => x.kind === "book_flight");
            const res = act ? exec?.data.results.find((x) => x.actionId === act.id && x.status === "booked") : null;
            return res ? { ref: res.ref, message: res.message } : null;
          })()}
        />
      )}
      {/* Until the plan is written, the map shows what was found; then it moves into the plan. */}
      {view === "classic" && !plan && mapData?.bounds && <TripMap routes={mapData} landmarkId={landmarkId} title={title} taste={tasteLayer} />}
      {plan ? <PlanSection result={plan} places={places} routes={routes?.data} mapRoutes={mapData} landmarkId={landmarkId} title={title} agent={a} taste={taste} /> : agent && <Placeholder steps={steps} id="trip.plan" label="The plan" />}
      {view === "classic" && (intel || intelStep) && <Codex intel={intel} travel={travel} pending={intelStep?.status === "running" || intelStep?.status === "pending"} />}
      {a && a.tiers && a.tiers.length > 0 ? (
        <>
          <HotelLanes tiers={a.tiers} scores={a.hotelScores ?? []} places={places} chosenId={plan?.data.stayId ?? a.picks.stays[0]} bookingUrl={(p) => hotelSearchUrl(p, a)} />
          <PlacesSection title="Every hotel I found" places={a.stays} chosenId={plan?.data.stayId ?? a.picks.stays[0]} anchor={anchor} evidence={agent.evidence} />
        </>
      ) : (
        a && <PlacesSection title="Where you'll stay" places={a.stays} chosenId={plan?.data.stayId ?? a.picks.stays[0]} anchor={anchor} evidence={agent.evidence} />
      )}
      {a && <PlacesSection title="Where you'll host it" places={a.venues} chosenId={plan?.data.venueId ?? a.picks.venues[0]} anchor={anchor} />}
      {a && <PlacesSection title="Where you'll eat" places={a.dines} chosenId={a.picks.dines[0]} anchor={anchor} />}
      {a && <PlacesSection title="Things to do" places={a.activities} chosenId={a.picks.activities[0]} anchor={anchor} />}
    </>
  );
}

function NeedsArtist({ plan, message, preview, placeholder, onSubmit }: { plan: Plan; message: string; preview: string[]; placeholder: string; onSubmit: (answer: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="lg agent-card needs"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v.trim());
      }}
    >
      {plan.ack && (
        <p className="agent-says">
          <span className="agent-dot" aria-hidden="true" />
          {plan.ack}
        </p>
      )}
      <label htmlFor="needs-artist" className="needs-q">
        {message}
      </label>
      <div className="needs-row">
        <input id="needs-artist" value={v} onChange={(e) => setV(e.target.value)} maxLength={120} placeholder={placeholder} autoFocus autoComplete="off" />
        <button type="submit" className="go" disabled={!v.trim()}>
          Start
        </button>
      </div>
      {preview.length > 0 && (
        <div className="needs-plan">
          <p className="muted small">Then I&rsquo;ll</p>
          <ol>
            {preview.slice(0, 5).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
      )}
    </form>
  );
}

/** Booking.com search for one hotel on the trip's dates (prices and availability live there). */
function hotelSearchUrl(p: { name: string }, a: TripAgentOutput): string {
  const city = a.where.city ? [a.where.city.name, a.where.city.country].filter(Boolean).join(", ") : a.trip.destination;
  const q = new URLSearchParams({ ss: `${p.name}, ${city}`, group_adults: String(a.trip.adults), no_rooms: String(a.trip.rooms) });
  if (a.trip.startDate) q.set("checkin", a.trip.startDate);
  if (a.trip.endDate) q.set("checkout", a.trip.endDate);
  return `https://www.booking.com/searchresults.html?${q}`;
}
