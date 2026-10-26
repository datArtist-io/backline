"use client";
// The plan on a map: OpenStreetMap tiles with each day's route drawn on the roads, numbered stops
// and the places the agent picked. Dependency-free: tiles are plain images, routes are SVG.
// Drag to pan (mouse), buttons to zoom, tabs to switch days. Phones get one-tap directions.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TripRoutesOutput } from "@backline/engine";

type Day = TripRoutesOutput["days"][number];
type Point = TripRoutesOutput["points"][number];
type View = { z: number; cx: number; cy: number };

const TILE = 256;
// OpenStreetMap's own tiles need no key (CARTO's now do). A keyed provider can be set with
// NEXT_PUBLIC_MAP_TILES ({z}/{x}/{y}, optional {s} subdomain) and NEXT_PUBLIC_MAP_ATTRIBUTION.
const CUSTOM_TILES = process.env.NEXT_PUBLIC_MAP_TILES || "";
const TILES = CUSTOM_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || "";
const SUBDOMAINS = "abc";
const tileUrl = (template: string, z: number, x: number, y: number) =>
  template.replace("{s}", SUBDOMAINS[(x + y) % SUBDOMAINS.length]).replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
export const DAY_COLORS = ["#7b5cff", "#ff4fa3", "#f08c00", "#0ea5d8", "#1f9d5c", "#9b5de5", "#e5484d"];
const MIN_Z = 3;
const MAX_Z = 18;

const worldX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

/** The view that fits [south, west, north, east] into the box. */
export function fitView(b: [number, number, number, number], w: number, h: number, pad = 44): View {
  const [s, west, n, e] = b;
  for (let z = 16; z >= MIN_Z; z--) {
    const x1 = worldX(west, z);
    const x2 = worldX(e, z);
    const y1 = worldY(n, z);
    const y2 = worldY(s, z);
    if (x2 - x1 <= w - pad * 2 && y2 - y1 <= h - pad * 2) return { z, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }
  return { z: MIN_Z, cx: worldX((west + e) / 2, MIN_Z), cy: worldY((s + n) / 2, MIN_Z) };
}

const boundsOf = (coords: [number, number][]): [number, number, number, number] | null =>
  coords.length ? [Math.min(...coords.map((c) => c[0])), Math.min(...coords.map((c) => c[1])), Math.max(...coords.map((c) => c[0])), Math.max(...coords.map((c) => c[1]))] : null;

const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`);

/** Where the person's taste is concentrated, from Qloo's heatmap: [lat, lon, weight 0–1] points and the strongest zone. */
export type TasteLayer = { heat: [number, number, number][]; zone: { name: string | null; lat: number; lon: number; radiusKm: number } | null };

/** Pixels per kilometre at a latitude and zoom level. Pure. */
const pxPerKm = (lat: number, z: number) => (TILE * 2 ** z) / (40075 * Math.cos((lat * Math.PI) / 180));

type Placed = Day["stops"][number] & { n: number; xy: [number, number]; at: [number, number]; moved: boolean; label: { text: string; side: "left" | "right" } | null };

/**
 * Where to draw each stop: markers that would sit on top of each other are fanned out (with a
 * leader line to the real spot), and a name is shown only where it doesn't collide with another.
 * Repeat visits (the hotel at the end of the day) share the first marker. Pure.
 */
export function layoutStops(stops: (Day["stops"][number] & { xy: [number, number] })[], width: number): Placed[] {
  const out: Placed[] = [];
  const boxes: [number, number, number, number][] = [];
  const hits = (b: [number, number, number, number]) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
  stops.forEach((s, i) => {
    if (out.some((o) => o.id === s.id)) return; // drawn once; the list below the map shows the return leg
    let at: [number, number] = s.xy;
    let moved = false;
    for (let k = 0; k < 8 && out.some((o) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1]) < 26); k++) {
      const angle = -Math.PI / 2 + (k * Math.PI) / 4;
      at = [s.xy[0] + Math.cos(angle) * 30, s.xy[1] + Math.sin(angle) * 30];
      moved = true;
    }
    boxes.push([at[0] - 14, at[1] - 14, at[0] + 14, at[1] + 14]);
    out.push({ ...s, n: i + 1, at, moved, label: null });
  });
  if (width > 520) {
    for (const p of out) {
      if (p.implied) continue;
      const text = p.name.length > 26 ? `${p.name.slice(0, 25)}…` : p.name;
      const tw = text.length * 7 + 6;
      const right: [number, number, number, number] = [p.at[0] + 17, p.at[1] - 9, p.at[0] + 17 + tw, p.at[1] + 9];
      const left: [number, number, number, number] = [p.at[0] - 17 - tw, p.at[1] - 9, p.at[0] - 17, p.at[1] + 9];
      const fitsRight = right[2] < width - 50 && !hits(right);
      const fitsLeft = left[0] > 4 && !hits(left);
      if (fitsRight || fitsLeft) {
        const box = fitsRight ? right : left;
        boxes.push(box);
        p.label = { text, side: fitsRight ? "right" : "left" };
      }
    }
  }
  return out;
}

export type MapDay = number | "all" | "trip";

export default function TripMap({
  routes,
  landmarkId,
  title,
  active: activeProp,
  onActive,
  embedded = false,
  taste,
}: {
  routes: TripRoutesOutput;
  landmarkId?: string | null;
  title: string;
  /** The day shown (controlled by the plan, so its day cards and the map move together). */
  active?: MapDay;
  onActive?: (d: MapDay) => void;
  /** Inside the plan: no heading of its own, and the plan's day cards list the legs. */
  embedded?: boolean;
  taste?: TasteLayer | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const routed = routes.days.filter((d) => d.stops.length >= 2);
  const [ownActive, setOwnActive] = useState<MapDay>(routed[0]?.index ?? "all");
  const active = activeProp ?? ownActive;
  const setActive = (d: MapDay) => (onActive ? onActive(d) : setOwnActive(d));
  const hasTaste = Boolean(taste && taste.heat.length);
  const [showTaste, setShowTaste] = useState(true);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; id: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [routes.bounds === null]);

  const day = typeof active === "number" ? (routes.days.find((d) => d.index === active) ?? null) : null;
  const journey = routes.journey ?? null;
  const tripView = active === "trip" && journey;
  const focusBounds = useMemo(() => {
    if (day) return boundsOf([...day.path, ...day.stops.map((s) => [s.lat, s.lon] as [number, number])]);
    if (active === "trip" && journey && routes.bounds) {
      const [s0, w0, n0, e0] = routes.bounds;
      return boundsOf([[s0, w0], [n0, e0], [journey.from.lat, journey.from.lon], [journey.to.lat, journey.to.lon]]);
    }
    return routes.bounds;
  }, [day, routes.bounds, active, journey]);
  // A short glide whenever the map moves to a new day or the whole trip.
  const [glide, setGlide] = useState(0);
  useEffect(() => setGlide((g) => g + 1), [active]);
  const [calm, setCalm] = useState(false);
  useEffect(() => setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);

  const refit = useCallback(() => {
    if (size && focusBounds) setView(fitView(focusBounds, size.w, size.h));
  }, [size, focusBounds]);
  useEffect(refit, [refit]);

  const zoom = (dz: number) =>
    setView((v) => {
      if (!v) return v;
      const z = Math.max(MIN_Z, Math.min(MAX_Z, v.z + dz));
      const k = 2 ** (z - v.z);
      return { z, cx: v.cx * k, cy: v.cy * k };
    });

  if (!routes.bounds) return null;
  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const v = view;
  const px = (lat: number, lon: number): [number, number] => (v ? [worldX(lon, v.z) - (v.cx - w / 2), worldY(lat, v.z) - (v.cy - h / 2)] : [0, 0]);

  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  if (v && w && h) {
    const n = 2 ** v.z;
    const x0 = Math.floor((v.cx - w / 2) / TILE);
    const x1 = Math.floor((v.cx + w / 2) / TILE);
    const y0 = Math.max(0, Math.floor((v.cy - h / 2) / TILE));
    const y1 = Math.min(n - 1, Math.floor((v.cy + h / 2) / TILE));
    for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++) {
        const x = ((tx % n) + n) % n;
        tiles.push({ key: `${v.z}/${tx}/${ty}`, src: tileUrl(TILES, v.z, x, ty), left: Math.round(tx * TILE - (v.cx - w / 2)), top: Math.round(ty * TILE - (v.cy - h / 2)) });
      }
  }

  const color = (i: number) => DAY_COLORS[i % DAY_COLORS.length];
  const line = (path: [number, number][]) => path.map(([la, lo]) => px(la, lo).map((n) => n.toFixed(1)).join(",")).join(" ");
  const stopsOnDay = new Set(day?.stops.map((s) => s.id) ?? []);
  const others: Point[] = routes.points.filter((p) => !stopsOnDay.has(p.id) && (p.picked || active === "all"));
  const placed = layoutStops(day ? day.stops.map((s) => ({ ...s, xy: px(s.lat, s.lon) })) : [], w);

  const directions = day?.directions ? (
    <a className="act map-directions" href={day.directions} target="_blank" rel="noopener noreferrer">
      {embedded ? "Open in Maps" : `Directions for day ${day.index + 1}`}
    </a>
  ) : null;
  const tabs =
    routed.length > 1 || journey ? (
      <div className="map-tabs" role="tablist" aria-label="Choose a day">
        {journey && (
          <button type="button" role="tab" aria-selected={active === "trip"} className={`map-tab trip${active === "trip" ? " on" : ""}`} onClick={() => setActive("trip")}>
            <span className="map-swatch round" aria-hidden="true" />
            Round trip
          </button>
        )}
        <button type="button" role="tab" aria-selected={active === "all"} className={`map-tab${active === "all" ? " on" : ""}`} onClick={() => setActive("all")}>
          All days
        </button>
        {routed.map((d) => (
          <button key={d.index} type="button" role="tab" aria-selected={active === d.index} className={`map-tab${active === d.index ? " on" : ""}`} onClick={() => setActive(d.index)}>
            <span className="map-swatch" style={{ background: color(d.index) }} aria-hidden="true" />
            Day {d.index + 1}
          </button>
        ))}
      </div>
    ) : null;
  const Wrapper = embedded ? "div" : "section";

  return (
    <Wrapper className={`trip-map${embedded ? " is-embedded" : " section"}`} {...(embedded ? {} : { "aria-labelledby": "map-title" })}>
      {embedded ? (
        (tabs || directions) && (
          <div className="map-bar">
            {tabs ?? <span className="map-bar-label">{day ? `Day ${day.index + 1}: ${mins(day.minutes)} of travel, ${day.km} km` : "On the map"}</span>}
            {directions}
          </div>
        )
      ) : (
        <>
          <div className="section-head">
            <h2 className="section-title" id="map-title">
              {routed.length ? "Your routes" : "On the map"}
            </h2>
            {directions}
          </div>
          {tabs}
        </>
      )}
      <div className="lg map-frame">
        <div
          ref={box}
          className={`map-surface${CUSTOM_TILES ? "" : " is-osm"}${calm ? "" : " is-glide"}`}
          data-glide={glide % 2}
          role="img"
          aria-label={`Map of ${title}${day ? `: day ${day.index + 1}, ${day.stops.length} stops, about ${mins(day.minutes)} of travel` : ""}`}
          onPointerDown={(e) => {
            if (!v || e.pointerType === "touch" || e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, id: e.pointerId };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            setView((cur) => (cur ? { ...cur, cx: d.cx - (e.clientX - d.x), cy: d.cy - (e.clientY - d.y) } : cur));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onDoubleClick={() => zoom(1)}
        >
          {tiles.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.key}
              className="map-tile"
              src={t.src}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              style={{ left: t.left, top: t.top }}
              onLoad={(e) => e.currentTarget.classList.add("is-loaded")}
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
          ))}
          {v && w > 0 && (
            <svg className="map-overlay" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
              {hasTaste && showTaste && taste && <TasteHeat taste={taste} px={px} z={v.z} calm={calm} />}
              {routes.days
                .filter((d) => d.path.length >= 2)
                .map((d) => {
                  const on = active === "all" || d.index === active;
                  const focus = d.index === active;
                  const pts = line(d.path);
                  return (
                    <g key={`${d.index}-${glide}`} opacity={on ? 1 : active === "trip" ? 0.55 : 0.22} className="map-route">
                      <polyline points={pts} fill="none" stroke="#fff" strokeWidth={on ? 9 : 6} strokeLinecap="round" strokeLinejoin="round" />
                      <polyline
                        points={pts}
                        fill="none"
                        stroke={color(d.index)}
                        strokeWidth={focus ? 5.5 : on ? 4.5 : 3.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={d.legs.some((l) => l.estimated) ? undefined : 1}
                        className={d.legs.some((l) => l.estimated) ? undefined : calm ? undefined : "route-draw"}
                        strokeDasharray={d.legs.some((l) => l.estimated) ? "2 9" : undefined}
                      />
                      {focus && !calm && d.path.length >= 2 && (
                        <circle r="5.5" fill="#fff" stroke={color(d.index)} strokeWidth="3" className="route-dot">
                          <animateMotion dur={`${Math.min(9, Math.max(3.5, d.minutes / 6))}s`} repeatCount="indefinite" begin="0.9s" path={`M${pts.split(" ").join(" L")}`} />
                        </circle>
                      )}
                    </g>
                  );
                })}
              {tripView && journey && <JourneyArcs journey={journey} px={px} calm={calm} />}
              {others.map((p) => {
                const [x, y] = px(p.lat, p.lon);
                const star = p.id === landmarkId;
                return (
                  <g key={p.id} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
                    {star ? (
                      <path d="M0,-11 L3.2,-3.4 11,-3.4 4.8,1.6 7.2,9.4 0,4.8 -7.2,9.4 -4.8,1.6 -11,-3.4 -3.2,-3.4Z" fill="#10132b" stroke="#fff" strokeWidth="2" />
                    ) : (
                      <circle r={p.picked ? 6.5 : 4.5} fill={p.picked ? "#10132b" : "#fff"} stroke={p.picked ? "#fff" : "#10132b"} strokeWidth="2" />
                    )}
                  </g>
                );
              })}
              {day &&
                placed.map((s) => {
                  const star = s.id === landmarkId;
                  return (
                    <g key={`${s.id}-${s.n}`}>
                      {s.moved && <line x1={s.xy[0]} y1={s.xy[1]} x2={s.at[0]} y2={s.at[1]} stroke="#10132b" strokeOpacity="0.35" strokeWidth="1.5" />}
                      <g transform={`translate(${s.at[0].toFixed(1)},${s.at[1].toFixed(1)})`}>
                        <circle r="13" fill={star ? "#10132b" : color(day.index)} stroke="#fff" strokeWidth="2.5" />
                        <text textAnchor="middle" dy="4.5" fontSize="12" fontWeight="700" fill="#fff">
                          {star ? "★" : s.implied ? "⌂" : s.n}
                        </text>
                        {s.label && (
                          <text x={s.label.side === "left" ? -19 : 19} textAnchor={s.label.side === "left" ? "end" : "start"} dy="4" fontSize="12.5" fontWeight="600" fill="#10132b" stroke="#fff" strokeWidth="3.5" paintOrder="stroke">
                            {s.label.text}
                          </text>
                        )}
                      </g>
                    </g>
                  );
                })}
            </svg>
          )}
          {hasTaste && (
            <button type="button" className={`map-taste-toggle${showTaste ? " on" : ""}`} aria-pressed={showTaste} onClick={() => setShowTaste((x) => !x)}>
              <span className="map-taste-dot" aria-hidden="true" />
              Your taste
            </button>
          )}
          <div className="map-zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1)}>
              +
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => zoom(-1)}>
              −
            </button>
            <button type="button" aria-label="Fit the route" onClick={refit}>
              ⤢
            </button>
          </div>
          <p className="map-credit">
            ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              OpenStreetMap
            </a>{" "}
            contributors{ATTRIBUTION ? ` · ${ATTRIBUTION}` : ""}
            {hasTaste && showTaste ? " · Taste heatmap by Qloo" : ""}
          </p>
        </div>
      </div>
      {!embedded && day && day.legs.length > 0 && <DaySummary day={day} />}
      {routes.provider === "estimate" && <p className="muted small">Travel times are estimates: road routing didn&rsquo;t answer this time.</p>}
    </Wrapper>
  );
}

function DaySummary({ day }: { day: Day }) {
  return (
    <ol className="map-legs">
      {day.stops.map((s, i) => (
        <li key={`${s.id}-${i}`} className="map-leg">
          <span className="map-leg-n">{s.implied ? "⌂" : i + 1}</span>
          <span className="map-leg-body">
            <span className="map-leg-name">
              {s.implied ? `Back to ${s.name}` : s.name}
              {s.time && <span className="muted"> · {s.time}</span>}
            </span>
            {i < day.legs.length && (
              <span className="map-leg-travel">
                {day.legs[i].mode === "walk" ? "Walk" : "Drive"} {mins(day.legs[i].minutes)} · {day.legs[i].km} km{day.legs[i].estimated ? " (estimate)" : ""}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

const MODE_ICON: Record<string, string> = { flight: "✈", train: "🚆", bus: "🚌", car: "🚗" };

/** There and back as two arcs between home and the arrival point, with the way of travel in the middle. */
function JourneyArcs({ journey, px, calm }: { journey: NonNullable<TripRoutesOutput["journey"]>; px: (lat: number, lon: number) => [number, number]; calm: boolean }) {
  const a = px(journey.from.lat, journey.from.lon);
  const b = px(journey.to.lat, journey.to.lon);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bend = Math.min(140, len * 0.28);
  const arc = (side: 1 | -1) => {
    const c: [number, number] = [(a[0] + b[0]) / 2 + nx * bend * side, (a[1] + b[1]) / 2 + ny * bend * side];
    const mid: [number, number] = [0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]];
    return { d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${c[0].toFixed(1)},${c[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`, mid };
  };
  const out = arc(1);
  const back = arc(-1);
  const icon = MODE_ICON[journey.mode] ?? "➜";
  const label = (p: [number, number], text: string, anchorLeft: boolean) => (
    <text x={p[0] + (anchorLeft ? -14 : 14)} y={p[1] + 4} textAnchor={anchorLeft ? "end" : "start"} fontSize="12.5" fontWeight="700" fill="#10132b" stroke="#fff" strokeWidth="3.5" paintOrder="stroke">
      {text}
    </text>
  );
  return (
    <g className="journey">
      <path d={out.d} fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <path d={out.d} fill="none" stroke="#ff4fa3" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="10 8" className={calm ? undefined : "journey-flow"} />
      <path d={back.d} fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" />
      <path d={back.d} fill="none" stroke="#0ea5d8" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="10 8" className={calm ? undefined : "journey-flow back"} />
      {[out.mid, back.mid].map((m, i) => (
        <g key={i} transform={`translate(${m[0].toFixed(1)},${m[1].toFixed(1)})`}>
          <circle r="13" fill="#fff" stroke={i === 0 ? "#ff4fa3" : "#0ea5d8"} strokeWidth="2.5" />
          <text textAnchor="middle" dy="4.5" fontSize="12">
            {icon}
          </text>
        </g>
      ))}
      <circle cx={a[0]} cy={a[1]} r="7" fill="#10132b" stroke="#fff" strokeWidth="2.5" />
      {label(a, `Home: ${journey.from.name}`, a[0] > b[0])}
      <circle cx={b[0]} cy={b[1]} r="7" fill="#ff4fa3" stroke="#fff" strokeWidth="2.5" />
      {label(b, journey.to.name, b[0] >= a[0])}
    </g>
  );
}

/**
 * Qloo's taste heatmap: soft glows where the person's taste is concentrated, strongest brightest,
 * and a ring around the zone searches centre on.
 */
function TasteHeat({ taste, px, z, calm }: { taste: TasteLayer; px: (lat: number, lon: number) => [number, number]; z: number; calm: boolean }) {
  const lat0 = taste.zone?.lat ?? taste.heat[0]?.[0] ?? 0;
  const k = pxPerKm(lat0, z);
  // Each heatmap cell covers roughly a square kilometre; glows overlap so the city reads as one surface.
  // Zoomed in, they stay small and faint so the streets and route stay readable.
  const r = Math.max(9, Math.min(46, k * 0.75));
  const fade = Math.max(0.2, Math.min(1, 25 / k));
  const zone = taste.zone;
  const zp = zone ? px(zone.lat, zone.lon) : null;
  const zr = zone ? Math.max(18, zone.radiusKm * k) : 0;
  return (
    <g className="taste-heat">
      <defs>
        <radialGradient id="taste-glow">
          <stop offset="0%" stopColor="#ff3d9a" stopOpacity="0.85" />
          <stop offset="45%" stopColor="#a855f7" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#7b5cff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g style={{ mixBlendMode: "multiply" }}>
        {taste.heat.map(([la, lo, wgt], i) => {
          const [x, y] = px(la, lo);
          return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={(r * (0.7 + wgt * 0.6)).toFixed(1)} fill="url(#taste-glow)" opacity={((0.06 + wgt * 0.4) * fade).toFixed(2)} />;
        })}
      </g>
      {zp && zr < 220 && (
        <g transform={`translate(${zp[0].toFixed(1)},${zp[1].toFixed(1)})`}>
          <circle r={zr.toFixed(1)} fill="none" stroke="#ff3d9a" strokeWidth="2.5" strokeDasharray="6 6" className={calm ? undefined : "taste-ring"} />
          {zone?.name && (
            <text y={(-zr - 8).toFixed(1)} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#b0136a" stroke="#fff" strokeWidth="4" paintOrder="stroke">
              Your taste: {zone.name}
            </text>
          )}
        </g>
      )}
    </g>
  );
}
