"use client";
// The adventure map: the trip as a game world. Qloo's taste is the terrain; every place is a quest;
// each day is a route you can fly; the field guide holds everything else a traveller needs.
import dynamic from "next/dynamic";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StepProgress } from "@backline/engine";
import { Vector3 } from "three";
import type { Shared } from "./World";
import { KIND_COLOR, KIND_LABEL, KIND_NOUN, type AdventureModel, type NodeKind, type QuestNode } from "./model";
import Codex from "./Codex";
import "./adventure.css";

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

type Toast = { id: number; text: string; xp?: number };

const pct = (v: number | null) => (v == null ? null : Math.round(v * 100));
const SCAN_LABEL: Record<string, string> = {
  "trip.taste": "Reading your taste in Qloo",
  "trip.flights": "Finding flights",
  "trip.agent": "Scouting places on the ground",
  "trip.plan": "Writing the plan",
  "trip.routes": "Drawing the routes",
  "trip.intel": "Gathering the field guide",
  "trip.actions": "Lining up what I can do",
  "trip.execute": "Doing the work",
};

export default function AdventureView({
  model,
  steps,
  activity,
  scanning,
  intelPending,
  onClassic,
  note,
}: {
  model: AdventureModel | null;
  steps: MissionStep[];
  activity: StepProgress[];
  scanning: boolean;
  intelPending: boolean;
  onClassic?: () => void;
  note?: string;
}) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setOk(hasWebGL());
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<number | "all">("all");
  const [play, setPlay] = useState(false);
  const [guide, setGuide] = useState(false);
  const [filter, setFilter] = useState<NodeKind | "all">("all");
  const [introKey, setIntroKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState({ day: -1, t: 0 });
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [done, setDone] = useState(false);
  const progress = useRef({ day: -1, t: 0 });
  const labels = useRef(new Map<string, HTMLElement>());
  const toastId = useRef(0);
  const shared = useRef<Shared>({ drone: { pos: new Vector3(), heading: 0 }, focusUntil: 0, homeUntil: 0, follow: false, hours: 21 });

  const selected = useMemo(() => model?.nodes.find((n) => n.id === selectedId) ?? null, [model, selectedId]);
  const toast = useCallback((text: string, xp?: number) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, xp }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setPlay(false);
      shared.current.follow = false;
    }
  }, []);
  // The camera flies to the selection until the person grabs the map again (onUserMove).
  useEffect(() => {
    if (selectedId) shared.current.focusUntil = Number.MAX_SAFE_INTEGER;
  }, [selectedId]);

  const home = useCallback(() => {
    setSelectedId(null);
    shared.current.homeUntil = Number.MAX_SAFE_INTEGER;
    window.setTimeout(() => (shared.current.homeUntil = 0), 1800);
  }, []);

  const onUserMove = useCallback(() => {
    shared.current.homeUntil = 0;
    shared.current.focusUntil = 0;
  }, []);

  const routes = model?.routes ?? [];
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
    shared.current.focusUntil = 0;
    shared.current.follow = true;
    setPlay(true);
    const r = routes.find((x) => x.day === first);
    toast(`Day ${first + 1} · ${r?.label ?? "Go"}`);
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
      toast(`${q?.time ? q.time + " · " : ""}${n.name}`, n.xp);
    },
    [model, routes, toast]
  );
  const onDayDone = useCallback(
    (d: number) => {
      const next = routes.find((r) => r.day > d);
      if (next) {
        progress.current = { day: next.day, t: 0 };
        setActiveDay(next.day);
        toast(`Day ${next.day + 1} · ${next.label}`);
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
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === "Escape") {
        setSelectedId(null);
        setGuide(false);
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
    for (const key of visited) {
      const id = key.split(":")[1];
      total += model.nodes.find((n) => n.id === id)?.xp ?? 0;
    }
    return total;
  }, [visited, model]);

  const matchByKind = useMemo(() => {
    const kinds: NodeKind[] = ["stay", "dine", "venue", "activity", "landmark"];
    return kinds.map((k) => {
      const ms = (model?.nodes ?? []).filter((n) => n.kind === k && n.picked && n.match != null).map((n) => n.match as number);
      return { k, v: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, n: ms.length };
    });
  }, [model]);

  if (ok === false) {
    return (
      <div className="adv adv-fallback">
        <p>Your browser can't show the 3D map, so here's the classic view.</p>
        {onClassic && <button type="button" onClick={onClassic}>Open classic view</button>}
      </div>
    );
  }

  const listed = (model?.nodes ?? []).filter((n) => n.picked && (filter === "all" || n.kind === filter)).sort((a, b) => (b.match ?? 0) - (a.match ?? 0));
  const recent = activity.filter((e) => e.kind === "act" || e.kind === "saw" || e.kind === "think").slice(-6);
  const percent = tick.day === (typeof activeDay === "number" ? activeDay : -1) ? Math.round(tick.t * 100) : 0;

  return (
    <section className={`adv${ready ? " is-ready" : ""}`} aria-label="Adventure map">
      <div className="adv-stage" onDoubleClick={home}>
        <Quiet fallback={<div className="adv-fallback"><p>The 3D map couldn't start here.</p>{onClassic && <button type="button" onClick={onClassic}>Open classic view</button>}</div>}>
          {ok && (
            <World
              model={model}
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
              labels={labels}
              shared={shared}
              scanning={scanning}
              reduced={reduced}
              introKey={introKey}
              onUserMove={onUserMove}
              onReady={() => setReady(true)}
            />
          )}
        </Quiet>
        <div className="adv-labels" aria-hidden="true">
          {model?.nodes.map((n) => (
            <div key={n.id} className={`adv-label k-${n.kind}${selectedId === n.id ? " sel" : ""}`} ref={(el) => { if (el) labels.current.set(n.id, el); else labels.current.delete(n.id); }} style={{ ["--c" as string]: KIND_COLOR[n.kind] }}>
              <i />
              {n.name}
              {n.match != null && n.picked && <b>{pct(n.match)}</b>}
            </div>
          ))}
        </div>
        <div className="adv-vignette" aria-hidden="true" />

        {/* top left: where you are */}
        <header className="adv-title">
          <span className="adv-eyebrow">{model?.sample ? "Sample data · " : ""}Adventure map</span>
          <h2>{model?.city || model?.title || "Scanning the world…"}</h2>
          {model?.title && model.city && <p>{model.title}</p>}
        </header>

        {/* top right: score */}
        {model && (
          <div className="adv-score" aria-label="Trip stats">
            <div><b>{model.stats.picked}</b><span>quests</span></div>
            <div><b>{model.stats.days || "–"}</b><span>days</span></div>
            <div><b>{model.stats.km ? Math.round(model.stats.km) : "–"}</b><span>km</span></div>
            <div className="hl"><b>{model.stats.match ?? "–"}{model.stats.match != null ? "%" : ""}</b><span>Qloo match</span></div>
            <div className="xp"><b>{xp.toLocaleString("en")}</b><span>/ {model.stats.xp.toLocaleString("en")} XP</span><i style={{ width: `${model.stats.xp ? Math.min(100, (xp / model.stats.xp) * 100) : 0}%` }} /></div>
          </div>
        )}

        {/* left: Qloo, king */}
        {model?.taste && (
          <aside className="adv-qloo">
            <h3><span className="q-dot" aria-hidden="true" /> Powered by Qloo</h3>
            {model.taste.signals.length > 0 && <p className="q-sig">Because you love <b>{model.taste.signals.join(", ")}</b></p>}
            <svg viewBox="-72 -66 144 132" className="q-radar" role="img" aria-label="Taste match by category">
              {[0.33, 0.66, 1].map((s) => <polygon key={s} points={matchByKind.map((_, i) => ring(i, matchByKind.length, 46 * s)).join(" ")} />)}
              {matchByKind.map((_, i) => <line key={i} x1="0" y1="0" x2={ring(i, matchByKind.length, 46).split(",")[0]} y2={ring(i, matchByKind.length, 46).split(",")[1]} />)}
              <polygon className="q-fill" points={matchByKind.map((m, i) => ring(i, matchByKind.length, 6 + 40 * m.v)).join(" ")} />
              {matchByKind.map((m, i) => {
                const [x, y] = ring(i, matchByKind.length, 56).split(",").map(Number);
                return <text key={m.k} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{KIND_LABEL[m.k as NodeKind].split(" ")[0]}</text>;
              })}
            </svg>
            <div className="q-tags">
              {[...model.taste.vibes.slice(0, 3), ...model.taste.scenes.slice(0, 2), ...model.taste.dishes.slice(0, 3)].map((t) => <span key={t}>{t}</span>)}
            </div>
            {model.zone?.name && <p className="q-zone"><i aria-hidden="true" /> Hottest zone: <b>{model.zone.name}</b></p>}
          </aside>
        )}

        {/* the agent at work */}
        {scanning && (
          <aside className="adv-scan" aria-live="polite">
            <h3><span className="pulse" aria-hidden="true" /> Agent online</h3>
            <ul className="scan-steps">
              {steps.filter((s) => SCAN_LABEL[s.id]).map((s) => (
                <li key={s.id} className={`st-${s.status}`}>
                  <i aria-hidden="true" />
                  {SCAN_LABEL[s.id]}
                </li>
              ))}
            </ul>
            <ol className="scan-feed">
              {recent.map((e, i) => (
                <li key={i} className={`k-${e.kind}${e.ok === false ? " bad" : ""}`}>{e.text}</li>
              ))}
            </ol>
          </aside>
        )}

        {/* the quest card */}
        {selected && <QuestCard key={selected.id} node={selected} onClose={() => setSelectedId(null)} routesDays={selected.visits.map((v) => v.day)} />}

        {/* toasts */}
        <div className="adv-toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="adv-toast">
              {t.text}
              {t.xp ? <b>+{t.xp} XP</b> : null}
            </div>
          ))}
        </div>

        {done && (
          <div className="adv-done" role="status">
            <b>Trip complete</b>
            <span>{model?.stats.picked} quests · {model?.stats.km ? Math.round(model.stats.km) : 0} km · {xp.toLocaleString("en")} XP</span>
            <button type="button" onClick={() => setDone(false)}>Nice</button>
          </div>
        )}

        {!ready && ok && <div className="adv-boot" aria-hidden="true"><span>Booting the map…</span></div>}
        {note && <p className="adv-note">{note}</p>}
      </div>

      {/* bottom: days and controls */}
      <div className="adv-bar">
        <div className="adv-days" role="tablist" aria-label="Days">
          <button role="tab" aria-selected={activeDay === "all"} className={activeDay === "all" ? "on" : ""} onClick={() => { setActiveDay("all"); stop(); progress.current = { day: -1, t: 0 }; }}>
            All days
          </button>
          {routes.map((r) => (
            <button key={r.day} role="tab" aria-selected={activeDay === r.day} className={activeDay === r.day ? "on" : ""} style={{ ["--c" as string]: r.color }} onClick={() => { setActiveDay(r.day); stop(); progress.current = { day: r.day, t: 0 }; setTick({ day: r.day, t: 0 }); }}>
              <i /> Day {r.day + 1}
              <small>{r.label}</small>
            </button>
          ))}
        </div>
        <div className="adv-actions">
          {routes.length > 0 && (
            <button type="button" className={`fly${play ? " on" : ""}`} onClick={play ? stop : start}>
              {play ? `■ Stop · ${percent}%` : done ? "▶ Fly it again" : "▶ Fly the trip"}
            </button>
          )}
          <button type="button" onClick={home} title="Back to the overview (double-click the map)">⌖ Overview</button>
          <button type="button" onClick={() => setIntroKey((k) => k + 1)} title="Replay the dive in">↻</button>
          <button type="button" className={guide ? "on" : ""} onClick={() => setGuide((g) => !g)}>
            ✦ Field guide{intelPending ? "…" : ""}
          </button>
          {onClassic && <button type="button" onClick={onClassic}>Classic view</button>}
        </div>
      </div>

      {/* quest log for the active day, or everything */}
      <div className="adv-log">
        <div className="adv-filter" role="group" aria-label="Filter places">
          {(["all", "stay", "dine", "venue", "activity", "landmark"] as const).map((k) => (
            <button key={k} className={filter === k ? "on" : ""} style={k === "all" ? undefined : { ["--c" as string]: KIND_COLOR[k] }} onClick={() => setFilter(k)}>
              {k === "all" ? "Everything" : KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {day ? (
          <ol className="adv-quests">
            {day.quests.map((q, i) => {
              const n = model?.nodes.find((x) => x.id === q.nodeId) ?? null;
              const seen = visited.has(`${day.day}:${q.nodeId}`);
              return (
                <li key={i} className={`${seen ? "seen" : ""}${n && selectedId === n.id ? " sel" : ""}`}>
                  <button type="button" disabled={!n} onClick={() => n && select(n.id)} style={{ ["--c" as string]: n ? KIND_COLOR[n.kind] : "#8fa3ff" }}>
                    <time>{q.time}</time>
                    <span>{q.title}</span>
                    {n?.match != null && <b>{pct(n.match)}%</b>}
                  </button>
                  {q.note && <p>{q.note}</p>}
                </li>
              );
            })}
          </ol>
        ) : (
          <ul className="adv-cards">
            {listed.map((n) => (
              <li key={n.id}>
                <button type="button" className={selectedId === n.id ? "sel" : ""} style={{ ["--c" as string]: KIND_COLOR[n.kind] }} onClick={() => select(n.id)} onMouseEnter={() => setHoverId(n.id)} onMouseLeave={() => setHoverId(null)}>
                  <small>{KIND_LABEL[n.kind]}</small>
                  <span>{n.name}</span>
                  {n.match != null && <i style={{ ["--w" as string]: `${pct(n.match)}%` }}><b>{pct(n.match)}%</b></i>}
                </button>
              </li>
            ))}
            {listed.length === 0 && <li className="adv-empty">{scanning ? "Places appear here as the agent finds them." : "Nothing here yet."}</li>}
          </ul>
        )}
      </div>

      {guide && (
        <div className="adv-guide">
          <button type="button" className="adv-guide-x" onClick={() => setGuide(false)} aria-label="Close field guide">×</button>
          <Codex intel={model?.intel ?? null} travel={model?.travel ?? null} pending={intelPending} />
        </div>
      )}
    </section>
  );
}

function ring(i: number, n: number, r: number): string {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
}

function QuestCard({ node, onClose, routesDays }: { node: QuestNode; onClose: () => void; routesDays: number[] }) {
  const p = node.place;
  const m = pct(node.match);
  const link = p?.website ?? p?.sources?.[0]?.url ?? null;
  return (
    <aside className="adv-card" style={{ ["--c" as string]: KIND_COLOR[node.kind] }}>
      <button type="button" className="adv-card-x" onClick={onClose} aria-label="Close">×</button>
      <small className="kind">{KIND_NOUN[node.kind]}</small>
      <h3>{node.name}</h3>
      {m != null && (
        <div className="match" aria-label={`Qloo match ${m} percent`}>
          <div><i style={{ width: `${m}%` }} /></div>
          <span><b>{m}%</b> Qloo match{node.fromQloo ? "" : " (estimated)"}</span>
        </div>
      )}
      {p?.why?.length ? <ul className="why">{p.why.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      <dl>
        {p?.address && (<><dt>Where</dt><dd>{p.address}</dd></>)}
        {p?.rating != null && (<><dt>Rating</dt><dd>{p.rating.toFixed(1)} / 5</dd></>)}
        {p?.priceNote && (<><dt>Price</dt><dd>{p.priceNote}</dd></>)}
        {routesDays.length > 0 && (<><dt>On your trip</dt><dd>{node.visits.map((v) => `Day ${v.day + 1} · ${v.time}`).join(", ")}</dd></>)}
      </dl>
      {node.visits.some((v) => v.note) && <p className="vnote">{node.visits.find((v) => v.note)?.note}</p>}
      <footer>
        <span className="xp">+{node.xp} XP</span>
        {link && <a href={link} target="_blank" rel="noreferrer noopener">Open ↗</a>}
      </footer>
    </aside>
  );
}
