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
import Background from "../Background";
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
  bookLabel = "Trip book",
  toolbar = null,
  homeHref = "/",
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
  bookLabel?: string;
  toolbar?: ReactNode;
  homeHref?: string;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | "all">("all");
  const [play, setPlay] = useState(false);
  const [sheet, setSheet] = useState<"guide" | "book" | null>(null);
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
      toast(n.name, q?.time ? `${q.time} · ${KIND_NOUN[n.kind]}` : KIND_NOUN[n.kind], n.xp);
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
      } else if (e.key === " " && routes.length) {
        e.preventDefault();
        if (play) stop();
        else start();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [play, routes.length, start, stop]);

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
  const hour = selectedHour ?? clock ?? 13;
  const weather = useMemo(() => ({ kind: sky, hour }), [sky, hour]);

  const chapters = useMemo(() => CHAPTERS.filter((c) => steps.some((s) => s.id === c.id)).map((c) => ({ ...c, status: steps.find((s) => s.id === c.id)?.status ?? "pending" })), [steps]);
  const current = chapters.find((c) => c.status === "running") ?? chapters.find((c) => c.status === "pending") ?? null;
  const dest = destination ?? model?.destination ?? null;
  const city = model?.city || dest?.name || null;
  const from = origin ?? model?.origin ?? null;

  const pad = useMemo(() => (narrow ? { top: 250, right: 24, bottom: 230, left: 24 } : { top: 140, right: selected ? 420 : 60, bottom: 230, left: model?.taste ? 330 : 60 }), [narrow, selected, model?.taste]);

  // The day selector's indicator glides to the active day.
  useEffect(() => {
    const box = daysRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-day="${activeDay}"]`);
    if (!box || !el) return setInk(null);
    setInk({ x: el.offsetLeft, w: el.offsetWidth, c: typeof activeDay === "number" ? routes.find((r) => r.day === activeDay)?.color ?? "#ff3d9a" : "#ff3d9a" });
  }, [activeDay, routes, narrow, ready]);
  const shownMatch = useCountUp(model?.stats.match ?? null, ready);
  const shownXp = useCountUp(xp, true);

  if (ok === false) {
    return (
      <div className={`eq eq-fallback${fullscreen ? " is-full" : ""}`}>
        <p>Your browser can't show the 3D map, so here's the classic view.</p>
        {onClassic && <button type="button" className="eq-btn" onClick={onClassic}><span>Open classic view</span></button>}
      </div>
    );
  }

  const strip = day
    ? day.quests.map((q) => ({ key: `${day.day}:${q.order}`, time: q.time, title: q.title, node: model?.nodes.find((x) => x.id === q.nodeId) ?? null, seen: q.nodeId ? visited.has(`${day.day}:${q.nodeId}`) : false }))
    : (model?.nodes ?? []).filter((n) => n.picked).sort((a, b) => (b.match ?? 0) - (a.match ?? 0)).map((n) => ({ key: n.id, time: null as string | null, title: n.name, node: n, seen: false }));
  const percent = typeof activeDay === "number" && tick.day === activeDay ? tick.t : 0;
  const matchPct = model?.stats.match ?? null;

  return (
    <section className={`eq${fullscreen ? " is-full" : ""}${ready ? " is-ready" : ""}${play ? " is-flying" : ""}`} aria-label={city ? `Your trip to ${city}` : "Your trip"}>
      <div className="eq-stage">
        {/* The landing page's light sculpture carries on behind the globe until you arrive. */}
        {blobs && (
          <div className={`eq-blobs${arrived ? " is-gone" : ""}`} aria-hidden="true">
            <Background />
          </div>
        )}
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
        <div className="eq-shade" aria-hidden="true" />

        {/* where you're going */}
        <header className="eq-head">
          <a className="eq-home" href={homeHref} aria-label="Backline home">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Backline
          </a>
          {city ? (
            <h1 key={city}>{city.split(",")[0]}</h1>
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
                {narrow && model.taste?.signals.length ? <span className="eq-because">Because you love {model.taste.signals.slice(0, 2).join(", ")}</span> : null}
                <span>{model.stats.picked} places · {model.stats.days ? `${model.stats.days} days` : "plan coming"}{model.stats.km ? ` · ${Math.round(model.stats.km)} km` : ""}</span>
                <span className="eq-xpn">{(shownXp ?? 0).toLocaleString("en")} <small>/ {model.stats.xp.toLocaleString("en")} XP</small></span>
                <span className="eq-xp" aria-label={`${xp} of ${model.stats.xp} points`}>
                  <i style={{ width: `${model.stats.xp ? Math.min(100, (xp / model.stats.xp) * 100) : 0}%` }} />
                </span>
              </div>
            </div>
          )}
          {weatherDay && (
            <div className={`eq-wx sky-${sky}`} aria-label={`${weatherDay.label}, high ${Math.round(weatherDay.tmax ?? 0)} degrees`}>
              <WxIcon kind={sky} night={hour < 6.5 || hour > 19} />
              <b>{weatherDay.tmax != null ? `${Math.round(weatherDay.tmax)}°` : "–"}</b>
              <span>{weatherDay.label}</span>
              <em>{typeof activeDay === "number" ? `Day ${activeDay + 1}, ` : ""}{fmtHour(hour)}</em>
            </div>
          )}
          <nav className="eq-doors" aria-label="Trip">
            <button type="button" className={sheet === "guide" ? "on" : ""} onClick={() => setSheet((s) => (s === "guide" ? null : "guide"))}>
              Field guide{intelPending ? <span className="eq-dot" aria-label="still gathering" /> : null}
            </button>
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
            {model.taste.signals.length > 0 && <p className="eq-sig">Because you love {model.taste.signals.slice(0, 4).join(", ")}</p>}
            <ol className="eq-tops" aria-label="Qloo's top pick of each kind">
              {topPicks.map((n) => (
                <li key={n.id} style={{ ["--c" as string]: KIND_COLOR[n.kind] }}>
                  <button type="button" onClick={() => select(n.id)}>
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
        {selected && <PlaceCard key={selected.id} node={selected} onClose={() => setSelectedId(null)} city={city} />}

        {/* arrivals */}
        <div className="eq-toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="eq-toast">
              <b>{t.text}</b>
              {t.sub && <span>{t.sub}</span>}
              {t.xp ? <em>+{t.xp}</em> : null}
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

          {strip.length > 0 && (
            <ol className={`eq-strip${day ? " is-day" : ""}`} aria-label={day ? `Day ${day.day + 1} stops` : "Places picked for you"}>
              {strip.map((s, i) => (
                <li key={s.key} className={`${s.seen ? "seen" : ""}${s.node && selectedId === s.node.id ? " sel" : ""}`} style={{ ["--i" as string]: Math.min(i, 12) }}>
                  <button type="button" disabled={!s.node} onClick={() => s.node && select(s.node.id)} onMouseEnter={() => s.node && setHoverId(s.node.id)} onMouseLeave={() => setHoverId(null)} style={{ ["--c" as string]: s.node ? KIND_COLOR[s.node.kind] : "#9fb2d9" }}>
                    {s.time ? <time>{s.time}</time> : <small>{s.node ? KIND_LABEL[s.node.kind] : ""}</small>}
                    <span>{s.title}</span>
                    {s.node?.rank && <b title={`Qloo ranks it ${s.node.rank.n} of ${s.node.rank.of} for your taste`}>#{s.node.rank.n}</b>}
                  </button>
                </li>
              ))}
            </ol>
          )}

          {(routes.length > 0 || (model && model.nodes.length > 0)) && (
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
              <div className="eq-tools">
                <button type="button" onClick={home} title="See the whole trip">Whole trip</button>
                <button type="button" onClick={() => setIntroKey((k) => k + 1)} title="Fly in from home again">Fly in again</button>
                {mode === "earth" && (
                  <button type="button" onClick={() => setLook((l) => nextLook(l))} title="Switch how the world is drawn">
                    {LOOK_LABEL[nextLook(look)]}
                  </button>
                )}
                <button type="button" onClick={() => setMode((m) => (m === "earth" ? "taste" : "earth"))} title="Switch between the real city and the taste map">{mode === "earth" ? "Taste map" : "Real world"}</button>
                {onClassic && <button type="button" onClick={onClassic}>Classic view</button>}
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

function PlaceCard({ node, onClose, city }: { node: QuestNode; onClose: () => void; city: string | null }) {
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
      <small className="eq-kind">{KIND_NOUN[node.kind]}</small>
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
      <dl>
        {p?.address && (<><dt>Address</dt><dd>{p.address}</dd></>)}
        {p?.rating != null && (<><dt>Rating</dt><dd>{p.rating.toFixed(1)} out of 5</dd></>)}
        {p?.priceNote && (<><dt>Price</dt><dd>{p.priceNote}</dd></>)}
        {node.visits.length > 0 && (<><dt>When</dt><dd>{node.visits.map((v) => `Day ${v.day + 1}, ${v.time}`).join(" · ")}</dd></>)}
      </dl>
      {node.visits.find((v) => v.note)?.note && <p className="eq-vnote">{node.visits.find((v) => v.note)!.note}</p>}
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
