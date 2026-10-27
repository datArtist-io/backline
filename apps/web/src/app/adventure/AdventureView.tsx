"use client";
// The expedition: the trip played out on the real Earth. You arrive from home across the globe,
// land in the city, and every place the agent picked stands as a beacon you can visit. Qloo's taste
// is the terrain. Each day is a route you can fly. Everything else lives in the field guide and
// the trip book, one tap away.
import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StepProgress } from "@backline/engine";
import { Vector3 } from "three";
import type { Shared } from "./World";
import type { Spot } from "./Earth";
import { GOOGLE_KEY } from "./Earth";
import { skyKind, type Sky } from "./world";
import { KIND_COLOR, KIND_LABEL, KIND_NOUN, hoursOf, type AdventureModel, type NodeKind, type QuestNode } from "./model";
import Codex from "./Codex";
import Space from "./Space";
import "./adventure.css";

const Earth = dynamic(() => import("./Earth"), { ssr: false });
const World = dynamic(() => import("./World"), { ssr: false });

class Quiet extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export type MissionStep = { id: string; title: string; status: string };

type Toast = { id: number; text: string; sub?: string; xp?: number };

const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));

/** The journey of the agent's work, told as chapters in the order they happen. */
const CHAPTERS: { id: string; label: string; doing: string }[] = [
  { id: "trip.taste", label: "Taste", doing: "Reading your taste in Qloo" },
  { id: "trip.travel", label: "Getting there", doing: "Working out how you'll get there" },
  { id: "trip.flights", label: "Flights", doing: "Checking flights" },
  { id: "trip.agent", label: "Places", doing: "Scouting the places your taste points to" },
  { id: "trip.plan", label: "Plan", doing: "Shaping your days" },
  { id: "trip.routes", label: "Routes", doing: "Drawing the routes on real streets" },
  { id: "trip.intel", label: "Field guide", doing: "Gathering weather, money, rules and guides" },
  { id: "trip.actions", label: "Bookings", doing: "Lining up what I can book" },
  { id: "trip.execute", label: "Booking", doing: "Booking it" },
];

/** Reviewing the trip before anything is booked: drop or swap places, say what to change, then book. */
export type ReviewApi = {
  /** Bookings and messages prepared and waiting for approval. */
  ready: number;
  edits: { remove: string[]; swap: { from: string; to: string }[]; note: string };
  /** The plan is being rewritten with the changes. */
  busy: boolean;
  /** What changed last time, in a sentence. */
  changed: string | null;
  onRemove: (id: string) => void;
  onSwap: (from: string, to: string) => void;
  onUndo: (kind: "remove" | "swap", id: string) => void;
  onNote: (note: string) => void;
  onApply: () => void;
  onBook: () => void;
};

export default function AdventureView({
  model,
  steps,
  scanning,
  intelPending,
  onClassic,
  note,
  destination = null,
  origin = null,
  subtitle = null,
  fullscreen = false,
  overlay = null,
  book = null,
  live = null,
  liveBusy = false,
  bookLabel = "Trip book",
  toolbar = null,
  homeHref = "/",
  review = null,
}: {
  model: AdventureModel | null;
  steps: MissionStep[];
  activity?: StepProgress[];
  scanning: boolean;
  intelPending: boolean;
  onClassic?: () => void;
  note?: string;
  destination?: Spot | null;
  origin?: Spot | null;
  subtitle?: string | null;
  fullscreen?: boolean;
  /** Something that needs the person's answer (a question, a confirmation): shown over the map. */
  overlay?: ReactNode;
  /** The detailed itinerary, bookings and every place found. */
  book?: ReactNode;
  /** The bookings happening live: calls, payments, confirmations. Opens by itself when they start. */
  live?: ReactNode;
  liveBusy?: boolean;
  bookLabel?: string;
  toolbar?: ReactNode;
  homeHref?: string;
  /** Before booking: the person vets the trip and adjusts it. */
  review?: ReviewApi | null;
}) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    setOk(hasWebGL());
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const mq = window.matchMedia?.("(max-width: 860px)");
    const on = () => setNarrow(Boolean(mq?.matches));
    on();
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  // Full screen: lock the page behind the expedition so only the map scrolls and zooms.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [fullscreen]);

  const [mode, setMode] = useState<"earth" | "taste">("earth");
  const [look, setLook] = useState<"photoreal" | "real" | "painted">(GOOGLE_KEY ? "photoreal" : "real");
  /** The hour on the trip's clock: follows the stops as you fly, so the light does too. */
  const [clock, setClock] = useState<number | null>(null);
  /** The time someone dragged to on the day's clock (Immersive View style), or null to follow the plan. */
  const [scrub, setScrub] = useState<number | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  // Light or dark: the system's choice until someone picks, then theirs (remembered on this device).
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("bl.theme");
    } catch {
      /* storage can be off */
    }
    setTheme(saved === "dark" || saved === "light" ? saved : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);
  const pickTheme = (t: "light" | "dark") => {
    setTheme(t);
    try {
      localStorage.setItem("bl.theme", t);
    } catch {
      /* fine */
    }
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | "all">("all");
  const [play, setPlay] = useState(false);
  const [sheet, setSheet] = useState<"guide" | "book" | "live" | null>(null);
  const hasLive = Boolean(live);
  useEffect(() => {
    if (hasLive) setSheet("live");
  }, [hasLive]);
  const [showTaste, setShowTaste] = useState(true);
  const [introKey, setIntroKey] = useState(0);
  const [homeKey, setHomeKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState({ day: -1, t: 0 });
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [done, setDone] = useState(false);
  const daysRef = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ x: number; w: number; c: string } | null>(null);
  const arrived = Boolean(model && (model.nodes.length > 0 || model.heat.length > 0));
  const [blobs, setBlobs] = useState(true);
  // Let the blobs fade, then unmount them so the GPU is all the map's.
  useEffect(() => {
    if (!arrived) return setBlobs(true);
    const t = window.setTimeout(() => setBlobs(false), 1600);
    return () => window.clearTimeout(t);
  }, [arrived]);
  const progress = useRef({ day: -1, t: 0 });
  const labels = useRef(new Map<string, HTMLElement>());
  const toastId = useRef(0);
  const shared = useRef<Shared>({ drone: { pos: new Vector3(), heading: 0 }, focusUntil: 0, homeUntil: 0, follow: false, hours: 21 });

  const selected = useMemo(() => model?.nodes.find((n) => n.id === selectedId) ?? null, [model, selectedId]);
  const [stopKey, setStopKey] = useState<string | null>(null);
  const nameOf = useCallback((id: string) => model?.nodes.find((n) => n.id === id)?.name ?? "a place", [model]);
  const toast = useCallback((text: string, sub?: string, xp?: number) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, sub, xp }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setPlay(false);
      shared.current.follow = false;
    }
  }, []);
  useEffect(() => {
    if (selectedId) shared.current.focusUntil = Number.MAX_SAFE_INTEGER;
  }, [selectedId]);

  const home = useCallback(() => {
    setSelectedId(null);
    setHomeKey((k) => k + 1);
    shared.current.homeUntil = Number.MAX_SAFE_INTEGER;
    window.setTimeout(() => (shared.current.homeUntil = 0), 1800);
  }, []);

  const onUserMove = useCallback(() => {
    shared.current.homeUntil = 0;
    shared.current.focusUntil = 0;
  }, []);

  const routes = useMemo(() => model?.routes ?? [], [model]);
  const day = typeof activeDay === "number" ? routes.find((r) => r.day === activeDay) ?? null : null;

  const start = useCallback(() => {
    if (!routes.length) return;
    const first = typeof activeDay === "number" ? activeDay : routes[0].day;
    setActiveDay(first);
    progress.current = { day: first, t: 0 };
    setTick({ day: first, t: 0 });
    setVisited(new Set());
    setDone(false);
    setSelectedId(null);
    setSheet(null);
    shared.current.focusUntil = 0;
    shared.current.follow = true;
    setPlay(true);
    const r = routes.find((x) => x.day === first);
    setClock(hoursOf(r?.quests[0]?.time) ?? 9);
    toast(`Day ${first + 1}`, r?.label);
  }, [routes, activeDay, toast]);

  const stop = useCallback(() => {
    setPlay(false);
    shared.current.follow = false;
  }, []);

  const onArrive = useCallback(
    (nodeId: string, d: number) => {
      const n = model?.nodes.find((x) => x.id === nodeId);
      if (!n) return;
      setVisited((v) => (v.has(`${d}:${nodeId}`) ? v : new Set(v).add(`${d}:${nodeId}`)));
      const q = routes.find((r) => r.day === d)?.quests.find((x) => x.nodeId === nodeId);
      const h = hoursOf(q?.time);
      if (h != null) setClock(h);
      toast(n.name, q?.time ? `${q.time} · ${KIND_NOUN[n.kind]}` : KIND_NOUN[n.kind]);
    },
    [model, routes, toast]
  );
  const onDayDone = useCallback(
    (d: number) => {
      const next = routes.find((r) => r.day > d);
      if (next) {
        progress.current = { day: next.day, t: 0 };
        setActiveDay(next.day);
        setClock(hoursOf(next.quests[0]?.time) ?? 9);
        toast(`Day ${next.day + 1}`, next.label);
      } else {
        setPlay(false);
        shared.current.follow = false;
        setDone(true);
        home();
      }
    },
    [routes, toast, home]
  );
  const onTick = useCallback((d: number, t: number) => setTick((p) => (p.day === d && Math.abs(p.t - t) < 0.004 ? p : { day: d, t })), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName) && e.key === " ") return;
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "Escape") {
        setSelectedId(null);
        setSheet(null);
        setViewOpen(false);
        setTimeOpen(false);
      } else if (e.key === " " && routes.length) {
        e.preventDefault();
        if (play) stop();
        else start();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [play, routes.length, start, stop]);

  // Kept for the stylised taste map's internal scoring; never shown.
  const xp = useMemo(() => {
    if (!model) return 0;
    let total = 0;
    for (const key of visited) total += model.nodes.find((n) => n.id === key.split(":")[1])?.xp ?? 0;
    return total;
  }, [visited, model]);

  const topPicks = useMemo(() => (["stay", "dine", "venue", "activity"] as NodeKind[]).flatMap((k) => (model?.nodes ?? []).filter((n) => n.kind === k && n.picked && n.affinity != null).sort((a, b) => b.affinity! - a.affinity!).slice(0, 1)), [model]);
  const matchByKind = useMemo(() => {
    const kinds: NodeKind[] = ["stay", "dine", "venue", "activity", "landmark"];
    return kinds.map((k) => {
      const ms = (model?.nodes ?? []).filter((n) => n.kind === k && n.picked && n.match != null).map((n) => n.match as number);
      return { k, v: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, n: ms.length };
    });
  }, [model]);

  const weatherDay = useMemo(() => {
    const days = model?.intel?.weather.days ?? [];
    const idx = typeof activeDay === "number" ? activeDay : 0;
    const date = routes.find((r) => r.day === idx)?.date ?? null;
    return days.find((d) => d.date === date) ?? days[idx] ?? days[0] ?? null;
  }, [model, activeDay, routes]);
  const sky: Sky = skyKind(weatherDay?.code ?? null, weatherDay?.label ?? null);
  const selectedHour = selected ? hoursOf((selected.visits.find((v) => v.day === activeDay) ?? selected.visits[0])?.time) : null;
  const hour = scrub ?? selectedHour ?? clock ?? 13;
  const weather = useMemo(() => ({ kind: sky, hour }), [sky, hour]);

  const chapters = useMemo(() => CHAPTERS.filter((c) => steps.some((s) => s.id === c.id)).map((c) => ({ ...c, status: steps.find((s) => s.id === c.id)?.status ?? "pending" })), [steps]);
  const current = chapters.find((c) => c.status === "running") ?? chapters.find((c) => c.status === "pending") ?? null;
  const dest = destination ?? model?.destination ?? null;
  const city = model?.city || dest?.name || null;
  const from = origin ?? model?.origin ?? null;

  // The journey in, with its cited fare and time when the research found them.
  const journey = useMemo(() => {
    const t = model?.travel;
    if (!from || !dest) return null;
    const best = t?.options.find((o) => o.mode === "flight") ?? t?.options.find((o) => o.best) ?? null;
    const fare = best?.priceMin != null ? ` · from ${best.priceMin.toLocaleString("en")} ${best.currency ?? ""}`.trimEnd() : "";
    const time = best?.duration ? ` · ${best.duration}` : "";
    return `${from.name.split(",")[0]} → ${dest.name.split(",")[0]}${fare}${time}`;
  }, [model?.travel, from, dest]);
  const pad = useMemo(() => (narrow ? { top: 190, right: 24, bottom: 230, left: 24 } : { top: 140, right: selected ? 420 : 60, bottom: 230, left: model?.taste ? 330 : 60 }), [narrow, selected, model?.taste]);

  // The day selector's indicator glides to the active day.
  useEffect(() => {
    const box = daysRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-day="${activeDay}"]`);
    if (!box || !el) return setInk(null);
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    setInk({ x: el.offsetLeft, w: el.offsetWidth, c: typeof activeDay === "number" ? routes.find((r) => r.day === activeDay)?.color ?? "#ff3d9a" : "#ff3d9a" });
  }, [activeDay, routes, narrow, ready]);
  const shownMatch = useCountUp(model?.stats.match ?? null, ready);

  if (ok === false) {
    return (
      <div className={`eq eq-fallback${fullscreen ? " is-full" : ""}`}>
        <p>Your browser can't show the 3D map, so here's the classic view.</p>
        {onClassic && <button type="button" className="eq-btn" onClick={onClassic}><span>Open classic view</span></button>}
      </div>
    );
  }

  const strip = day
    ? day.quests.map((q) => ({ key: `${day.day}:${q.order}`, time: q.time, title: q.title, note: q.note, node: model?.nodes.find((x) => x.id === q.nodeId) ?? null, seen: q.nodeId ? visited.has(`${day.day}:${q.nodeId}`) : false }))
    : (model?.nodes ?? []).filter((n) => n.picked).sort((a, b) => (b.match ?? 0) - (a.match ?? 0)).map((n) => ({ key: n.id, time: null as string | null, title: n.name, note: null as string | null, node: n, seen: false }));
  const percent = typeof activeDay === "number" && tick.day === activeDay ? tick.t : 0;
  const matchPct = model?.stats.match ?? null;

  return (
    <section data-theme={theme} style={gradeVars(sky, hour)} className={`eq${fullscreen ? " is-full" : ""}${ready ? " is-ready" : ""}${play ? " is-flying" : ""}`} aria-label={city ? `Your trip to ${city}` : "Your trip"}>
      <div className="eq-stage">
        {/* Deep space around the globe until you arrive in the city. */}
        {blobs && <Space active={!arrived} />}
        <Quiet fallback={<div className="eq-fallback"><p>The 3D map couldn&rsquo;t start here.</p>{onClassic && <button type="button" className="eq-btn" onClick={onClassic}><span>Open classic view</span></button>}</div>}>
          {ok && mode === "earth" && (
            <Earth
              model={model}
              destination={dest}
              origin={from}
              activeDay={activeDay}
              selectedId={selectedId}
              hoverId={hoverId}
              onSelect={select}
              onHover={setHoverId}
              play={play}
              progress={progress}
              onArrive={onArrive}
              onDayDone={onDayDone}
              onTick={onTick}
              scanning={scanning}
              reduced={reduced}
              introKey={introKey}
              homeKey={homeKey}
              showTaste={showTaste}
              look={look}
              weather={weather}
              journey={journey}
              pad={pad}
              onUserMove={onUserMove}
              onReady={() => setReady(true)}
            />
          )}
          {ok && mode === "taste" && (
            <>
              <World model={model} activeDay={activeDay} selectedId={selectedId} hoverId={hoverId} onSelect={select} onHover={setHoverId} play={play} progress={progress} onArrive={onArrive} onDayDone={onDayDone} onTick={onTick} labels={labels} shared={shared} scanning={scanning} reduced={reduced} introKey={introKey} onUserMove={onUserMove} onReady={() => setReady(true)} />
              <div className="adv-labels" aria-hidden="true">
                {model?.nodes.map((n) => (
                  <div key={n.id} className={`adv-label k-${n.kind}${selectedId === n.id ? " sel" : ""}`} ref={(el) => { if (el) labels.current.set(n.id, el); else labels.current.delete(n.id); }} style={{ ["--c" as string]: KIND_COLOR[n.kind] }}>
                    <i />
                    {n.name}
                    {n.match != null && n.picked && <b>{pct(n.match)}</b>}
                  </div>
                ))}
              </div>
            </>
          )}
        </Quiet>
        <div className="eq-grade" aria-hidden="true" />
        <div className="eq-tilt top" aria-hidden="true" />
        <div className="eq-tilt bottom" aria-hidden="true" />
        <div className="eq-shade" aria-hidden="true" />

        {/* where you're going */}
        <header className="eq-head">
          <a className="eq-home" href={homeHref} aria-label="Backline home">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Backline
          </a>
          {city ? (
            <h1 key={city}>{city.split(",")[0].replace(/^(Greater|City of|Metropolitan)\s+/i, "")}</h1>
          ) : (
            <h1 className="is-waiting">
              <span>Planning</span>
              <span className="eq-accent">your trip.</span>
            </h1>
          )}
          <p>
            {model?.sample && <span className="eq-tag">Sample trip</span>}
            {subtitle ?? (city && city.includes(",") ? city.split(",").slice(1).join(",").trim() : model?.title ?? "")}
          </p>
        </header>

        {/* the score and the doors to everything else */}
        <div className="eq-top">
          {model && model.stats.places > 0 && (
            <div className="eq-score">
              <svg viewBox="0 0 44 44" className="eq-dial" role="img" aria-label={matchPct != null ? `Average Qloo affinity of your picks: ${matchPct} out of 100` : "No Qloo scores yet"}>
                <defs>
                  <linearGradient id="eq-grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#ff4fa3" />
                    <stop offset="0.55" stopColor="#7b5cff" />
                    <stop offset="1" stopColor="#38d3ff" />
                  </linearGradient>
                </defs>
                <circle cx="22" cy="22" r="19" className="track" />
                <circle cx="22" cy="22" r="19" className="val" style={{ strokeDasharray: `${((matchPct ?? 0) / 100) * 119.4} 200` }} />
                <text x="22" y="23.5" textAnchor="middle" dominantBaseline="middle">{shownMatch ?? "–"}</text>
              </svg>
              <div className="eq-score-txt">
                <b>Qloo affinity</b>
                {narrow && model.taste?.signals.length ? <span className="eq-because">{model.taste.because}</span> : null}
                <span>{model.stats.picked} places · {model.stats.days ? `${model.stats.days} days` : "plan coming"}{model.stats.km ? ` · ${Math.round(model.stats.km)} km` : ""}</span>
              </div>
            </div>
          )}
          {weatherDay && (
            <div className={`eq-time${timeOpen ? " is-open" : ""}`}>
              <button type="button" className={`eq-wx sky-${sky}`} aria-expanded={timeOpen} onClick={() => setTimeOpen((o) => !o)} title="Change the time of day">
                <WxIcon kind={sky} night={hour < 6.5 || hour > 19} />
                <b>{tempAt(weatherDay, hour) != null ? `${tempAt(weatherDay, hour)}°` : "–"}</b>
                <span>{weatherDay.label}</span>
                <em>{typeof activeDay === "number" ? `Day ${activeDay + 1}, ` : ""}{fmtHour(hour)}</em>
              </button>
              {timeOpen && (
                <div className="eq-scrub">
                  <label htmlFor="eq-hour">See the day at</label>
                  <input id="eq-hour" type="range" min={5} max={23.75} step={0.25} value={hour} onChange={(e) => setScrub(Number(e.target.value))} style={{ ["--p" as string]: `${((hour - 5) / 18.75) * 100}%` }} />
                  <div className="eq-scrub-ticks" aria-hidden="true">
                    <span>Dawn</span>
                    <span>Noon</span>
                    <span>Dusk</span>
                    <span>Night</span>
                  </div>
                  <p>
                    {weatherDay.sunrise ? `Sunrise ${weatherDay.sunrise}` : ""}
                    {weatherDay.sunset ? ` · sunset ${weatherDay.sunset}` : ""}
                    {weatherDay.rainChance != null ? ` · ${Math.round(weatherDay.rainChance)}% chance of rain` : ""}
                  </p>
                  {scrub != null && <button type="button" className="eq-scrub-reset" onClick={() => setScrub(null)}>Follow the plan</button>}
                </div>
              )}
            </div>
          )}
          <nav className="eq-doors" aria-label="Trip">
            <button type="button" className={sheet === "guide" ? "on" : ""} onClick={() => setSheet((s) => (s === "guide" ? null : "guide"))}>
              Field guide{intelPending ? <span className="eq-dot" aria-label="still gathering" /> : null}
            </button>
            {live && (
              <button type="button" className={`eq-live-door${sheet === "live" ? " on" : ""}`} onClick={() => setSheet((s) => (s === "live" ? null : "live"))}>
                Bookings{liveBusy ? <span className="eq-dot" aria-label="in progress" /> : null}
              </button>
            )}
            {book && (
              <button type="button" className={sheet === "book" ? "on" : ""} onClick={() => setSheet((s) => (s === "book" ? null : "book"))}>
                {bookLabel}
              </button>
            )}
            {toolbar}
          </nav>
        </div>

        {/* Qloo: the reason for every pick */}
        {model?.taste && !narrow && (
          <aside className="eq-qloo" aria-label="Your taste, from Qloo">
            <h2><span className="eq-q" aria-hidden="true" />Your taste, by Qloo</h2>
            {model.taste.because && <p className="eq-sig">{model.taste.because}</p>}
            <ol className="eq-tops" aria-label="Qloo's top pick of each kind">
              {topPicks.map((n) => (
                <li key={n.id} style={{ ["--c" as string]: KIND_COLOR[n.kind] }}>
                  <button type="button" onClick={() => select(n.id)}>
                    <KindIcon kind={n.kind} />
                    <small>{KIND_LABEL[n.kind]}</small>
                    <span>{n.name}</span>
                    <b>{n.affinity!.toFixed(3)}</b>
                  </button>
                </li>
              ))}
            </ol>
            {[...model.taste.vibes.slice(0, 3), ...model.taste.dishes.slice(0, 3)].length > 0 && (
              <ul className="eq-tags">
                {[...model.taste.vibes.slice(0, 3), ...model.taste.scenes.slice(0, 2), ...model.taste.dishes.slice(0, 3)].map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
            {model.zone?.name && <p className="eq-zone">Your taste peaks around <b>{model.zone.name}</b></p>}
            {model.taste.alsoLoved.length > 0 && <p className="eq-also">Fans like you also love {model.taste.alsoLoved.slice(0, 3).join(", ")}</p>}
            <label className="eq-switch">
              <input type="checkbox" checked={showTaste} onChange={(e) => setShowTaste(e.target.checked)} />
              <span aria-hidden="true" /> Show taste on the map
            </label>
          </aside>
        )}

        {/* the place you're looking at */}
        {selected && (
          <PlaceCard
            key={selected.id}
            node={selected}
            onClose={() => setSelectedId(null)}
            city={city}
            review={review}
            others={model ? model.nodes.filter((n) => n.kind === selected.kind && n.id !== selected.id && n.visits.length === 0 && !review?.edits.remove.includes(n.id) && !review?.edits.swap.some((x) => x.to === n.id)).sort((a, b) => (b.affinity ?? b.match ?? 0) - (a.affinity ?? a.match ?? 0)).slice(0, 4) : []}
          />
        )}

        {/* a stop without a pinned place: what it is, when, and why */}
        {stopKey && !selected && (() => {
          const st = strip.find((x) => x.key === stopKey);
          if (!st) return null;
          return (
            <aside className="eq-stopcard" aria-label={st.title}>
              <button type="button" className="eq-x" onClick={() => setStopKey(null)} aria-label="Close">×</button>
              <small className="eq-kind">{day ? `Day ${day.day + 1}` : "Your trip"}{st.time ? ` · ${st.time}` : ""}</small>
              <h3>{st.title}</h3>
              {st.note ? <p>{st.note}</p> : <p>A free moment in the plan. Ask for a change in Adjust if you&rsquo;d like something booked here.</p>}
              {city && <a className="eq-btn" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${st.title}, ${city}`)}`} target="_blank" rel="noreferrer noopener"><span>Find it on the map</span></a>}
            </aside>
          );
        })()}

        {/* review before booking: vet the trip, adjust it, then book */}
        {review && !overlay && <ReviewBar review={review} names={nameOf} />}

        {/* arrivals */}
        <div className="eq-toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="eq-toast">
              <b>{t.text}</b>
              {t.sub && <span>{t.sub}</span>}
            </div>
          ))}
        </div>

        {done && (
          <div className="eq-done" role="status">
            <h2>That&rsquo;s the trip</h2>
            <p>{model?.stats.picked} places across {model?.stats.days} days, {model?.stats.km ? `${Math.round(model.stats.km)} km` : "on foot and by ride"}.</p>
            <div>
              {book && <button type="button" className="eq-btn gold" onClick={() => { setDone(false); setSheet("book"); }}><span>Open the trip book</span></button>}
              <button type="button" className="eq-btn" onClick={() => setDone(false)}><span>Keep exploring</span></button>
            </div>
          </div>
        )}


        {note && <p className="eq-note">{note}</p>}
        {overlay && <div className="eq-overlay">{overlay}</div>}

        {/* bottom: the agent at work, then the days to fly */}
        <div className="eq-dock">
          {scanning && (
            <div className="eq-mission" aria-live="polite">
              <p className="eq-doing">{!chapters.length ? "Reading your request" : current ? (current.id === "trip.agent" && city ? `Scouting ${city.split(",")[0]} for places your taste points to` : current.doing) : "Finishing up"}</p>
              {chapters.length > 0 && <ol className="eq-chapters">
                {chapters.map((c) => (
                  <li key={c.id} className={`is-${c.status}`}>
                    <i aria-hidden="true" />
                    <span>{c.label}</span>
                  </li>
                ))}
              </ol>}
            </div>
          )}

          {strip.length > 0 && !(narrow && scanning) && (
            <ol className={`eq-strip${day ? " is-day" : ""}`} aria-label={day ? `Day ${day.day + 1} stops` : "Places picked for you"}>
              {strip.map((s, i) => (
                <li key={s.key} className={`${s.seen ? "seen" : ""}${s.node && selectedId === s.node.id ? " sel" : ""}`} style={{ ["--i" as string]: Math.min(i, 12) }}>
                  <button type="button" aria-pressed={stopKey === s.key} onClick={() => (s.node ? (setStopKey(null), select(s.node.id)) : (setSelectedId(null), setStopKey((k) => (k === s.key ? null : s.key))))} onMouseEnter={() => s.node && setHoverId(s.node.id)} onMouseLeave={() => setHoverId(null)} style={{ ["--c" as string]: s.node ? KIND_COLOR[s.node.kind] : "#9fb2d9" }}>
                    <KindIcon kind={s.node?.kind ?? "stop"} />
                    {s.time ? <time>{s.time}</time> : <small>{s.node ? KIND_LABEL[s.node.kind] : ""}</small>}
                    <span>{s.title}</span>
                    {s.node?.rank && <b title={`Qloo ranks it ${s.node.rank.n} of ${s.node.rank.of} for your taste`}>#{s.node.rank.n}</b>}
                  </button>
                </li>
              ))}
            </ol>
          )}

          {(routes.length > 0 || (!scanning && model && model.nodes.length > 0)) && (
            <div className="eq-bar">
              {routes.length > 0 && (
                <button type="button" className={`eq-play${play ? " on" : ""}`} onClick={play ? stop : start} aria-label={play ? "Pause" : "Fly the trip"}>
                  <span className="eq-face">
                    <span className="eq-ico" aria-hidden="true">
                      {play ? (
                        <svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" /><rect x="9.6" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" /></svg>
                      ) : (
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4.5 2.8c0-.8.9-1.3 1.6-.9l7.4 4.6c.6.4.6 1.3 0 1.7l-7.4 4.6c-.7.4-1.6-.1-1.6-.9z" fill="currentColor" /></svg>
                      )}
                    </span>
                    <em>{play ? "Pause" : done ? "Fly it again" : "Fly the trip"}</em>
                  </span>
                </button>
              )}
              <div className="eq-days" role="tablist" aria-label="Days" ref={daysRef}>
                <i className="eq-ink" aria-hidden="true" style={ink ? { transform: `translateX(${ink.x}px)`, width: ink.w, ["--c" as string]: ink.c } : { opacity: 0 }} />
                <button role="tab" data-day="all" aria-selected={activeDay === "all"} className={activeDay === "all" ? "on" : ""} onClick={() => { setActiveDay("all"); stop(); setClock(null); progress.current = { day: -1, t: 0 }; home(); }}>
                  Overview
                </button>
                {routes.map((r) => (
                  <button key={r.day} role="tab" data-day={r.day} aria-selected={activeDay === r.day} className={activeDay === r.day ? "on" : ""} style={{ ["--c" as string]: r.color }} onClick={() => { setActiveDay(r.day); stop(); progress.current = { day: r.day, t: 0 }; setTick({ day: r.day, t: 0 }); }}>
                    <span>Day {r.day + 1}</span>
                    <small>{r.label}</small>
                    {activeDay === r.day && (
                      <i className="eq-track" aria-hidden="true">
                        <i style={{ width: `${percent * 100}%` }} />
                        {r.stops.map((s, i) => <b key={i} style={{ left: `${s.at * 100}%` }} className={visited.has(`${r.day}:${s.nodeId}`) ? "seen" : ""} />)}
                      </i>
                    )}
                  </button>
                ))}
              </div>
              <div className={`eq-tools${viewOpen ? " is-open" : ""}`}>
                <button type="button" className="eq-view-btn" aria-expanded={viewOpen} aria-haspopup="menu" onClick={() => setViewOpen((o) => !o)}>
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3.5c-4 0-7 3.6-7.6 5.6a1.3 1.3 0 0 0 0 .8C3 11.9 6 15.5 10 15.5s7-3.6 7.6-5.6a1.3 1.3 0 0 0 0-.8C17 7.1 14 3.5 10 3.5z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="10" cy="9.5" r="2.6" fill="currentColor" /></svg>
                  View
                </button>
                {viewOpen && (
                  <div className="eq-menu" role="menu" onClick={() => setViewOpen(false)}>
                    <button type="button" role="menuitem" onClick={home}>Whole trip</button>
                    <button type="button" role="menuitem" onClick={() => setIntroKey((k) => k + 1)}>Fly in again</button>
                    {mode === "earth" && LOOKS.map((l) => (
                      <button key={l} type="button" role="menuitemradio" aria-checked={look === l} className={look === l ? "on" : ""} onClick={() => setLook(l)}>{LOOK_LABEL[l]}</button>
                    ))}
                    <button type="button" role="menuitemradio" aria-checked={mode === "taste"} className={mode === "taste" ? "on" : ""} onClick={() => setMode((m) => (m === "earth" ? "taste" : "earth"))}>Taste map</button>
                    <button type="button" role="menuitem" onClick={() => pickTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light mode" : "Dark mode"}</button>
                    {onClassic && <button type="button" role="menuitem" onClick={onClassic}>Classic view</button>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {sheet === "guide" && (
          <div className="eq-sheet dark" role="dialog" aria-label="Field guide">
            <button type="button" className="eq-x" onClick={() => setSheet(null)} aria-label="Close field guide">×</button>
            <Codex intel={model?.intel ?? null} travel={model?.travel ?? null} pending={intelPending} />
          </div>
        )}
        {sheet === "live" && live && (
          <div className="eq-sheet live" role="dialog" aria-label="Your bookings">
            <button type="button" className="eq-x" onClick={() => setSheet(null)} aria-label="Close bookings">×</button>
            {live}
          </div>
        )}
        {sheet === "book" && book && (
          <div className="eq-sheet paper" role="dialog" aria-label={bookLabel}>
            <button type="button" className="eq-x" onClick={() => setSheet(null)} aria-label={`Close ${bookLabel}`}>×</button>
            {book}
          </div>
        )}
      </div>
    </section>
  );
}

/** Counts a number up to its value, with an ease-out, for a scoreboard feel. */
function useCountUp(target: number | null, run: boolean): number | null {
  const [v, setV] = useState<number | null>(target == null ? null : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target == null) return setV(null);
    if (!run) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setV(target);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      const e = 1 - Math.pow(1 - t, 3);
      const val = Math.round(a + (target - a) * e);
      setV(val);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return v;
}

type Look = "photoreal" | "real" | "painted";
const LOOKS: Look[] = GOOGLE_KEY ? ["photoreal", "real", "painted"] : ["real", "painted"];
const nextLook = (l: Look): Look => LOOKS[(LOOKS.indexOf(l) + 1) % LOOKS.length];
const LOOK_LABEL: Record<Look, string> = { photoreal: "Photoreal 3D", real: "Satellite", painted: "Painted map" };

/** A temperature for the hour from the day's low (around dawn) and high (mid-afternoon). Pure. */
function tempAt(d: { tmax: number | null; tmin: number | null }, h: number): number | null {
  if (d.tmax == null) return null;
  if (d.tmin == null) return Math.round(d.tmax);
  const f = h <= 6 ? 0 : h <= 15 ? (1 - Math.cos(((h - 6) / 9) * Math.PI)) / 2 : 1 - ((h - 15) / 15) * 0.7;
  return Math.round(d.tmin + (d.tmax - d.tmin) * Math.max(0, Math.min(1, f)));
}

/** Little icons with personality: each kind of place does something when you hover it. */
function KindIcon({ kind }: { kind: NodeKind }) {
  const paths: Record<NodeKind, ReactNode> = {
    stay: <><path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7" /><path d="M3 14h18M3 18v2M21 18v2" /><path className="ki-pillow" d="M6 9V7.5A1.5 1.5 0 0 1 7.5 6h3A1.5 1.5 0 0 1 12 7.5V9" /></>,
    dine: <><g className="ki-fork"><path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M9 3v6" /></g><g className="ki-knife"><path d="M17 21V3c-2 1.5-3 4-3 7v3h3" /></g></>,
    venue: <><g className="ki-note"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></g></>,
    activity: <><circle cx="12" cy="12" r="9" /><path className="ki-needle" d="m15.5 8.5-2 5-5 2 2-5z" /></>,
    landmark: <><path d="M5 21V4" /><path className="ki-flag" d="M5 4h11l-2 4 2 4H5" /></>,
    stop: <><path className="ki-plane" d="M2.5 13.5 21 6l-4 13-4.5-4.5L9 18v-5l9-6-11 5.5z" /></>,
  };
  return (
    <svg className={`ki ki-${kind}`} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}

/**
 * The colour grade, the way games do it: a filter on the world plus tinted light and haze, set by the
 * hour and the weather. Golden hour runs warm, night runs blue, rain runs grey. Pure.
 */
export function gradeVars(kind: Sky, hour: number): Record<string, string> {
  const h = ((hour % 24) + 24) % 24;
  const night = h < 6 || h >= 20 ? 1 : h < 7 ? 1 - (h - 6) : h >= 19 ? h - 19 : 0;
  const golden = Math.max(0, 1 - Math.abs(h - 18) / 1.6, 1 - Math.abs(h - 7.2) / 1.2) * (1 - night);
  const wet = kind === "rain" || kind === "storm" ? 1 : kind === "cloudy" || kind === "fog" ? 0.55 : kind === "snow" ? 0.4 : 0;
  const sat = 1.1 - wet * 0.22 - night * 0.3 + golden * 0.08;
  const bright = 1.02 - night * 0.42 - wet * 0.06;
  const contrast = 1.06 + golden * 0.04 + night * 0.06;
  const sepia = golden * 0.12;
  const tint = night > 0.5 ? "rgba(40, 60, 150, 0.55)" : golden > 0.2 ? `rgba(255, 150, 70, ${(0.22 + golden * 0.3).toFixed(2)})` : wet > 0.5 ? "rgba(120, 140, 165, 0.32)" : "rgba(255, 205, 140, 0.16)";
  const haze = night > 0.5 ? "rgba(30, 40, 90, 0.5)" : golden > 0.2 ? "rgba(255, 196, 150, 0.55)" : wet > 0.5 ? "rgba(205, 212, 222, 0.62)" : "rgba(214, 232, 255, 0.5)";
  return {
    ["--g-filter" as string]: `saturate(${sat.toFixed(2)}) contrast(${contrast.toFixed(2)}) brightness(${bright.toFixed(2)}) sepia(${sepia.toFixed(2)})`,
    ["--g-tint" as string]: tint,
    ["--g-haze" as string]: haze,
  };
}

const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

function WxIcon({ kind, night }: { kind: Sky; night: boolean }) {
  const sun = night ? <path d="M15 4a8 8 0 1 0 5 13 7 7 0 0 1-5-13z" fill="currentColor" /> : <><circle cx="12" cy="12" r="4.2" fill="currentColor" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="12" y1="3" x2="12" y2="5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${a} 12 12)`} />)}</>;
  const cloud = <path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.6 4.2 4.2 0 0 0 7 18z" fill="currentColor" />;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {kind === "clear" && sun}
      {kind === "partly" && <g><g transform="translate(-3 -3) scale(.8)" opacity=".9">{sun}</g><g transform="translate(2 2) scale(.85)">{cloud}</g></g>}
      {(kind === "cloudy" || kind === "fog") && cloud}
      {(kind === "rain" || kind === "storm") && <g>{cloud}<path d="M9 20l-1 2.5M13 20l-1 2.5M17 20l-1 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></g>}
      {kind === "snow" && <g>{cloud}<circle cx="9" cy="21.5" r="1" fill="currentColor" /><circle cx="13" cy="21.5" r="1" fill="currentColor" /><circle cx="17" cy="21.5" r="1" fill="currentColor" /></g>}
    </svg>
  );
}

function ring(i: number, n: number, r: number): string {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
}

function PlaceCard({ node, onClose, city, review = null, others = [] }: { node: QuestNode; onClose: () => void; city: string | null; review?: ReviewApi | null; others?: QuestNode[] }) {
  const [swapping, setSwapping] = useState(false);
  const removed = review?.edits.remove.includes(node.id) ?? false;
  const swappedTo = review?.edits.swap.find((x) => x.from === node.id)?.to ?? null;
  const inPlan = node.visits.length > 0 || node.picked;
  const p = node.place;
  const m = pct(node.match);
  const site = p?.website ?? null;
  const source = p?.sources?.[0]?.url ?? null;
  const q = encodeURIComponent([node.name, p?.address ?? city ?? ""].filter(Boolean).join(", "));
  const street = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${node.lat},${node.lon}`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${node.lat},${node.lon}`;
  const maps = `https://www.google.com/maps/search/?api=1&query=${q}`;
  return (
    <aside className="eq-card is-in" style={{ ["--c" as string]: KIND_COLOR[node.kind] }} aria-label={node.name}>
      <button type="button" className="eq-x" onClick={onClose} aria-label="Close">×</button>
      {p?.image && <div className="eq-card-img" style={{ backgroundImage: `url("${p.image.replace(/["\\]/g, "")}")` }} role="img" aria-label={node.name} />}
      <small className="eq-kind"><KindIcon kind={node.kind} />{KIND_NOUN[node.kind]}</small>
      <h3>{node.name}</h3>
      {node.affinity != null ? (
        <div className="eq-match" aria-label={`Qloo affinity ${node.affinity.toFixed(3)}`}>
          <div><i style={{ width: `${Math.round(node.affinity * 100)}%` }} /></div>
          <span><b>{node.affinity.toFixed(3)}</b> Qloo affinity{node.rank ? `, #${node.rank.n} of ${node.rank.of} ${PLURAL[node.kind]} Qloo scored for your taste` : ""}</span>
        </div>
      ) : m != null ? (
        <div className="eq-match" aria-label={`Estimated fit ${m} percent`}>
          <div><i style={{ width: `${m}%` }} /></div>
          <span><b>{m}%</b> estimated fit (not scored by Qloo)</span>
        </div>
      ) : null}
      {p?.why?.length ? <ul className="eq-why">{p.why.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      <dl className="eq-facts">
        <div><dt>Rating</dt><dd>{p?.rating != null ? `${p.rating.toFixed(1)} ★` : "Not rated"}</dd></div>
        <div><dt>Price</dt><dd>{p?.priceNote ?? (p?.priceLevel ? "$".repeat(p.priceLevel) : "Not listed")}</dd></div>
        <div><dt>When</dt><dd>{node.visits.length ? node.visits.slice(0, 2).map((v) => `Day ${v.day + 1}, ${v.time}`).join(" · ") + (node.visits.length > 2 ? ` +${node.visits.length - 2}` : "") : "Any time"}</dd></div>
        <div><dt>Qloo rank</dt><dd>{node.rank ? `#${node.rank.n} of ${node.rank.of}` : "Not ranked"}</dd></div>
        {p?.address && <div className="wide"><dt>Address</dt><dd>{p.address}</dd></div>}
      </dl>
      {node.visits.find((v) => v.note)?.note && <p className="eq-vnote">{node.visits.find((v) => v.note)!.note}</p>}
      {review && inPlan && node.kind !== "landmark" && node.kind !== "stop" && (
        <div className="eq-adjust" aria-label="Adjust this stop">
          {removed ? (
            <p className="eq-adjust-state">Will be removed when you update the plan. <button type="button" onClick={() => review.onUndo("remove", node.id)}>Keep it</button></p>
          ) : swappedTo ? (
            <p className="eq-adjust-state">Will be swapped for <b>{others.find((o) => o.id === swappedTo)?.name ?? "another place"}</b>. <button type="button" onClick={() => review.onUndo("swap", node.id)}>Undo</button></p>
          ) : (
            <div className="eq-adjust-row">
              <button type="button" className="eq-chip-btn" aria-expanded={swapping} onClick={() => setSwapping((v) => !v)} disabled={!others.length || review.busy}>
                <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M4 7h11l-3-3M16 13H5l3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Swap
              </button>
              <button type="button" className="eq-chip-btn" onClick={() => review.onRemove(node.id)} disabled={review.busy}>
                <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
                Remove
              </button>
            </div>
          )}
          {swapping && !removed && !swappedTo && (
            <ul className="eq-swaps">
              <li className="eq-swaps-head">Qloo&rsquo;s next best {PLURAL[node.kind]}</li>
              {others.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => { review.onSwap(node.id, o.id); setSwapping(false); }}>
                    <b>{o.name}</b>
                    <span>{o.affinity != null ? `${o.affinity.toFixed(3)} Qloo affinity` : o.place?.rating ? `${o.place.rating.toFixed(1)} ★` : "Found nearby"}{o.place?.priceLevel ? ` · ${"$".repeat(o.place.priceLevel)}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="eq-card-acts">
        <a href={street} target="_blank" rel="noreferrer noopener" className="eq-btn gold"><span>Look around</span></a>
        <a href={directions} target="_blank" rel="noreferrer noopener" className="eq-btn"><span>Directions</span></a>
        <a href={site ?? maps} target="_blank" rel="noreferrer noopener" className="eq-btn"><span>{site ? "Website" : "On Google Maps"}</span></a>
      </div>
      {source && !site && <p className="eq-src">Found via <a href={source} target="_blank" rel="noreferrer noopener">{hostOf(source)}</a></p>}
    </aside>
  );
}

const PLURAL: Record<NodeKind, string> = { stay: "stays", dine: "places to eat", venue: "venues", activity: "things to do", landmark: "landmarks", stop: "stops" };

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

/** The trip is planned and nothing is booked yet: look it over, adjust, then book. */
function ReviewBar({ review, names }: { review: ReviewApi; names: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const n = review.edits.remove.length + review.edits.swap.length + (review.edits.note.trim() ? 1 : 0);
  const apply = () => {
    review.onApply();
    setOpen(false);
  };
  return (
    <section className={`eq-review${open ? " is-open" : ""}${review.busy ? " is-busy" : ""}`} aria-label="Review your trip before booking">
      {open && (
        <div className="eq-review-panel">
          <h3>Adjust the trip</h3>
          <p className="eq-review-hint">Tap any place on the map to swap or remove it, or tell me what to change. Nothing is booked until you say so.</p>
          {(review.edits.remove.length > 0 || review.edits.swap.length > 0) && (
            <ul className="eq-review-changes">
              {review.edits.remove.map((id) => (
                <li key={`r${id}`}>
                  <span>Remove <b>{names(id)}</b></span>
                  <button type="button" onClick={() => review.onUndo("remove", id)} aria-label={`Keep ${names(id)}`}>Undo</button>
                </li>
              ))}
              {review.edits.swap.map((x) => (
                <li key={`s${x.from}`}>
                  <span><b>{names(x.from)}</b> → <b>{names(x.to)}</b></span>
                  <button type="button" onClick={() => review.onUndo("swap", x.from)} aria-label={`Keep ${names(x.from)}`}>Undo</button>
                </li>
              ))}
            </ul>
          )}
          <label className="eq-review-note">
            <span>Anything else?</span>
            <textarea rows={2} maxLength={500} value={review.edits.note} placeholder="e.g. a slower day 2, cheaper dinners, more live music" onChange={(e) => review.onNote(e.target.value)} />
          </label>
          <div className="eq-review-acts">
            <button type="button" className="eq-btn" onClick={() => setOpen(false)}><span>Close</span></button>
            <button type="button" className="eq-btn gold" disabled={!n || review.busy} onClick={apply}><span>{n ? `Update the plan (${n})` : "Update the plan"}</span></button>
          </div>
        </div>
      )}
      <div className="eq-review-bar">
        <span className="eq-review-dot" aria-hidden="true" />
        <div className="eq-review-txt">
          {review.busy ? (
            <b>Updating your plan…</b>
          ) : review.changed ? (
            <>
              <b>Plan updated</b>
              <span>{review.changed}</span>
            </>
          ) : (
            <>
              <b>Your trip is ready to review</b>
              <span>{review.ready ? `${review.ready} booking${review.ready === 1 ? "" : "s"} prepared. Nothing is booked yet.` : "Nothing is booked yet."}</span>
            </>
          )}
        </div>
        <button type="button" className="eq-review-adjust" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={review.busy}>
          Adjust{n ? <em>{n}</em> : null}
        </button>
        <button type="button" className="eq-review-book" onClick={review.onBook} disabled={review.busy || n > 0} title={n > 0 ? "Update the plan first" : undefined}>
          Review &amp; book
        </button>
      </div>
    </section>
  );
}
