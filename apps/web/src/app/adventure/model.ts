// The adventure map's data layer: turns what the agent found (places, the plan, the routes, the
// person's Qloo taste, the field guide) into a small "world" the 3D scene and the HUD both read.
// Pure and framework-free, so it's unit-tested without a browser.
import type { Place, TasteOutput, TripAgentOutput, TripIntelOutput, TripPlanOutput, TripTravelOutput, TripRoutesOutput } from "@backline/engine";

export type NodeKind = "stay" | "dine" | "venue" | "activity" | "landmark" | "stop";

export const KIND_LABEL: Record<NodeKind, string> = { stay: "Stay", dine: "Eat & drink", venue: "Venue", activity: "Experiences", landmark: "Landmark", stop: "Stop" };
export const KIND_NOUN: Record<NodeKind, string> = { stay: "Where you'll stay", dine: "Where you'll eat", venue: "Where you'll host it", activity: "Thing to do", landmark: "Landmark", stop: "Stop" };
export const KIND_COLOR: Record<NodeKind, string> = { stay: "#7cc4ff", dine: "#ffbe5c", venue: "#ff8a5b", activity: "#b39dff", landmark: "#eaf2ff", stop: "#9fb2d9" };
export const DAY_COLORS = ["#38d3ff", "#ff4fa3", "#ffb547", "#9b7bff", "#6dffb2", "#ff7a59", "#f0f4ff"];

export type Visit = { day: number; order: number; time: string; note: string | null };

export type QuestNode = {
  id: string;
  name: string;
  kind: NodeKind;
  lat: number;
  lon: number;
  /** World position (north is -z). */
  x: number;
  z: number;
  /** In the plan, or the agent's pick. */
  picked: boolean;
  /** How well it fits the person's taste (Qloo), 0–1, or null when there's no taste to match. */
  match: number | null;
  fromQloo: boolean;
  /** Qloo's own affinity score for this place and this person (0–1), when Qloo scored it. */
  affinity: number | null;
  /** Where Qloo ranks it among the places of its kind it scored: 1 is the best. */
  rank: { n: number; of: number } | null;
  /** XP the stop is worth: a base, plus up to as much again for a strong taste match. */
  xp: number;
  visits: Visit[];
  place: Place | null;
};

export type Quest = { day: number; order: number; time: string; title: string; note: string | null; nodeId: string | null; xp: number };

export type DayRoute = {
  day: number;
  label: string;
  date: string | null;
  color: string;
  /** The line to fly: [x, z] pairs in world units. */
  path: [number, number][];
  /** The same line on the real map: [lon, lat] pairs. */
  geo: [number, number][];
  /** Where each stop sits along the path, 0–1, in visiting order. */
  stops: { nodeId: string; at: number }[];
  km: number | null;
  minutes: number | null;
  quests: Quest[];
};

export type HeatPoint = { x: number; z: number; w: number; lat: number; lon: number };

export type AdventureModel = {
  title: string;
  city: string;
  sample: boolean;
  nodes: QuestNode[];
  routes: DayRoute[];
  heat: HeatPoint[];
  zone: { x: number; z: number; r: number; name: string | null; lat: number; lon: number; km: number } | null;
  /** The centre of the play area on the real map. */
  center: { lat: number; lon: number };
  /** Home and the destination city, when known, for the journey in. */
  origin: { name: string; lat: number; lon: number } | null;
  destination: { name: string; lat: number; lon: number } | null;
  /** Half the size of the play area, in world units. */
  extent: number;
  /** World units per kilometre. */
  scale: number;
  taste: { signals: string[]; because: string; vibes: string[]; scenes: string[]; dishes: string[]; audience: string | null; alsoLoved: string[] } | null;
  intel: TripIntelOutput | null;
  travel: TripTravelOutput | null;
  summary: string | null;
  stats: { places: number; picked: number; km: number; match: number | null; xp: number; days: number };
};

export type AdventureSource = {
  title: string;
  agent?: TripAgentOutput | null;
  plan?: TripPlanOutput | null;
  routes?: TripRoutesOutput | null;
  taste?: TasteOutput | null;
  intel?: TripIntelOutput | null;
  travel?: TripTravelOutput | null;
  sample?: boolean;
  /** Where the trip goes, known before the agent's places (for the early, taste-only world). */
  destination?: { name: string; lat: number; lon: number } | null;
};

// ---------- geometry ----------

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);
const HALF_WORLD = 24;

/** Straight-line distance between two world points. Pure. */
export const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Cumulative length along a path, for flying along it at an even pace. Pure. */
export function pathIndex(points: [number, number][]): { cum: number[]; total: number } {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  return { cum, total: cum[cum.length - 1] ?? 0 };
}

/** The point and heading (radians) a fraction t of the way along a path. Pure. */
export function pointAt(points: [number, number][], idx: { cum: number[]; total: number }, t: number): { x: number; z: number; heading: number } {
  if (!points.length) return { x: 0, z: 0, heading: 0 };
  if (points.length === 1 || idx.total === 0) return { x: points[0][0], z: points[0][1], heading: 0 };
  const d = Math.max(0, Math.min(1, t)) * idx.total;
  let i = 1;
  while (i < idx.cum.length - 1 && idx.cum[i] < d) i++;
  const seg = idx.cum[i] - idx.cum[i - 1] || 1;
  const f = (d - idx.cum[i - 1]) / seg;
  const a = points[i - 1];
  const b = points[i];
  return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
}

/** How far along the path (0–1) the point nearest to `p` is. Pure. */
export function fractionNear(points: [number, number][], idx: { cum: number[]; total: number }, p: [number, number], from = 0): number {
  if (!points.length || idx.total === 0) return 0;
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < points.length; i++) {
    if (idx.cum[i] / idx.total < from - 1e-6) continue;
    const d = dist(points[i], p);
    if (d < best) {
      best = d;
      at = idx.cum[i] / idx.total;
    }
  }
  return at;
}

/** "14:30" or "2:30 pm" to hours (14.5); null when it isn't a time. Pure. */
export function hoursOf(time: string | null | undefined): number | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(time ?? "");
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  return h + Number(m[2]) / 60;
}

// ---------- the model ----------

const kindOf = (p: Place, fallback: NodeKind): NodeKind => (p.kind === "stay" || p.kind === "dine" || p.kind === "venue" || p.kind === "activity" ? p.kind : fallback);
const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** The base XP for a stop and its taste bonus: strong Qloo matches are worth up to double. Pure. */
export const xpFor = (match: number | null) => 100 + Math.round((match ?? 0.4) * 100);

export function buildAdventure(src: AdventureSource): AdventureModel | null {
  const a = src.agent;
  if (!a) return tasteOnly(src);
  const plan = src.plan ?? null;
  const taste = src.taste ?? null;

  const picked = new Set<string>([...a.picks.stays, ...a.picks.dines, ...a.picks.venues, ...a.picks.activities]);
  if (plan?.stayId) picked.add(plan.stayId);
  if (plan?.venueId) picked.add(plan.venueId);
  for (const d of plan?.days ?? []) for (const it of d.items) if (it.placeId) picked.add(it.placeId);

  type Raw = { id: string; name: string; kind: NodeKind; lat: number; lon: number; place: Place | null };
  const raw: Raw[] = [];
  for (const [list, fb] of [[a.stays, "stay"], [a.dines, "dine"], [a.venues, "venue"], [a.activities, "activity"]] as const)
    for (const p of list) if (has(p.lat) && has(p.lon)) raw.push({ id: p.id, name: p.name, kind: kindOf(p, fb), lat: p.lat, lon: p.lon, place: p });
  for (const s of a.stops) raw.push({ id: s.id, name: s.name, kind: s.kind === "landmark" ? "landmark" : "stop", lat: s.lat, lon: s.lon, place: null });
  // Only the places that matter on screen: the picks and stops, then the best of the rest.
  const rank = (r: Raw) => (picked.has(r.id) || !r.place ? 2 : 0) + (r.place?.match ?? 0) + (r.place?.fit ?? 0) * 0.01;
  const keep = new Map<string, Raw>();
  for (const r of [...raw].sort((x, y) => rank(y) - rank(x)).slice(0, 48)) keep.set(r.id, r);
  const list = [...keep.values()];
  if (!list.length) return null;

  // World frame: centred on the places (and the taste heat around them), scaled so they fill the map.
  const heatRaw = taste?.heat ?? [];
  const lats = [...list.map((r) => r.lat), ...heatRaw.map((h) => h[0])];
  const lons = [...list.map((r) => r.lon), ...heatRaw.map((h) => h[1])];
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const spanKm = Math.max((Math.max(...lats) - Math.min(...lats)) * KM_PER_DEG_LAT, (Math.max(...lons) - Math.min(...lons)) * kmPerDegLon(lat0), 1.6);
  const scale = (HALF_WORLD * 2) / (spanKm * 1.15);
  const toWorld = (lat: number, lon: number): [number, number] => [(lon - lon0) * kmPerDegLon(lat0) * scale, -(lat - lat0) * KM_PER_DEG_LAT * scale];

  const nodes: QuestNode[] = list.map((r) => {
    const [x, z] = toWorld(r.lat, r.lon);
    const match = r.place?.match ?? null;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      lat: r.lat,
      lon: r.lon,
      x,
      z,
      picked: picked.has(r.id) || !r.place,
      match,
      fromQloo: Boolean(r.place && ((r.place.source ?? "").includes("qloo") || r.place.affinity != null || (r.place.why ?? []).some((w) => /qloo|fans of|taste/i.test(w)))),
      xp: xpFor(match),
      visits: [],
      place: r.place,
      affinity: r.place?.affinity ?? null,
      rank: null,
    };
  });
  // Rank each kind by Qloo's affinity: honest ordering, since raw scores often sit close together.
  for (const kind of ["stay", "dine", "venue", "activity"] as NodeKind[]) {
    const scored = nodes.filter((n) => n.kind === kind && n.affinity != null).sort((x, y) => y.affinity! - x.affinity!);
    scored.forEach((n, i) => (n.rank = { n: i + 1, of: scored.length }));
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Quests and routes, from the plan's days.
  const routes: DayRoute[] = [];
  (plan?.days ?? []).forEach((day, di) => {
    const quests: Quest[] = day.items.map((it, oi) => {
      const n = it.placeId ? byId.get(it.placeId) : undefined;
      if (n) n.visits.push({ day: di, order: oi, time: it.time, note: it.note });
      return { day: di, order: oi, time: it.time, title: it.title, note: it.note, nodeId: n?.id ?? null, xp: n ? n.xp : 60 };
    });
    const rd = src.routes?.days.find((d) => d.index === di) ?? null;
    const visited = quests.flatMap((q) => (q.nodeId ? [byId.get(q.nodeId)!] : [])).filter((n, i, arr) => i === 0 || arr[i - 1].id !== n.id);
    const roadGeo: [number, number][] = (rd?.path ?? []).map(([lat, lon]) => [lon, lat]);
    const roadPath = (rd?.path ?? []).map(([lat, lon]) => toWorld(lat, lon));
    const path: [number, number][] = roadPath.length >= 2 ? roadPath : visited.map((n) => [n.x, n.z] as [number, number]);
    const idx = pathIndex(path);
    let from = 0;
    const stops = visited.map((n) => {
      const at = path.length >= 2 ? fractionNear(path, idx, [n.x, n.z], from) : 0;
      from = Math.max(from, at);
      return { nodeId: n.id, at };
    });
    // Without a road path the stops are the path's own vertices: spread them evenly by distance.
    const evenStops = roadPath.length < 2 && idx.total > 0 ? visited.map((n, i) => ({ nodeId: n.id, at: idx.cum[i] / idx.total })) : stops;
    const geo: [number, number][] = roadGeo.length >= 2 ? roadGeo : visited.map((n) => [n.lon, n.lat] as [number, number]);
    routes.push({ day: di, label: day.label, date: day.date, color: DAY_COLORS[di % DAY_COLORS.length], path, geo, stops: evenStops, km: rd?.km ?? null, minutes: rd?.minutes ?? null, quests });
  });

  const heat: HeatPoint[] = heatRaw.map(([lat, lon, w]) => {
    const [x, z] = toWorld(lat, lon);
    return { x, z, w: Math.max(0, Math.min(1, w)), lat, lon };
  });
  const zone = taste?.zone ? (() => {
    const [x, z] = toWorld(taste.zone.lat, taste.zone.lon);
    return { x, z, r: Math.max(3, Math.min(14, taste.zone.radiusKm * scale)), name: taste.zone.name, lat: taste.zone.lat, lon: taste.zone.lon, km: taste.zone.radiusKm };
  })() : null;

  const pickedNodes = nodes.filter((n) => n.picked && n.place);
  const matches = pickedNodes.map((n) => n.affinity).filter(has);
  const totalXp = routes.length ? routes.reduce((s, r) => s + r.quests.reduce((t, q) => t + q.xp, 0), 0) : pickedNodes.reduce((s, n) => s + n.xp, 0);

  return {
    title: src.title,
    city: a.where.city ? [a.where.city.name, a.where.city.country].filter(Boolean).join(", ") : a.trip.destination,
    sample: Boolean(src.sample),
    nodes,
    routes,
    heat,
    zone,
    extent: HALF_WORLD * 1.25,
    center: { lat: lat0, lon: lon0 },
    origin: src.travel?.from && src.travel.origin ? { name: src.travel.origin, ...src.travel.from } : null,
    destination: a.where.city ? { name: a.where.city.display ?? a.where.city.name, lat: a.where.city.lat, lon: a.where.city.lon } : src.travel?.to && src.travel.destination ? { name: src.travel.destination, ...src.travel.to } : null,
    scale,
    taste: taste && (taste.signals.length || taste.tags.length || taste.vibes.length)
      ? { signals: [...taste.signals.map((s) => s.name), ...taste.tags.map((t) => t.name)].slice(0, 6), because: tasteBecause(taste), vibes: taste.vibes, scenes: taste.scenes, dishes: taste.dishes, audience: taste.audience, alsoLoved: taste.alsoLoved.map((x) => x.name).slice(0, 4) }
      : null,
    intel: src.intel ?? null,
    travel: src.travel ?? null,
    summary: plan?.summary ?? a.summary ?? null,
    stats: {
      places: nodes.filter((n) => n.place).length,
      picked: pickedNodes.length,
      km: Math.round(routes.reduce((s, r) => s + (r.km ?? 0), 0) * 10) / 10,
      match: matches.length ? Math.round((matches.reduce((s, m) => s + m, 0) / matches.length) * 100) : null,
      xp: totalXp,
      days: routes.length,
    },
  };
}

/** Before the agent has found places: Qloo's taste on the map already, so the wait is never empty. Pure. */
function tasteOnly(src: AdventureSource): AdventureModel | null {
  const taste = src.taste;
  const heatRaw = taste?.heat ?? [];
  if (!taste || !heatRaw.length) return null;
  const lats = heatRaw.map((h) => h[0]);
  const lons = heatRaw.map((h) => h[1]);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const spanKm = Math.max((Math.max(...lats) - Math.min(...lats)) * KM_PER_DEG_LAT, (Math.max(...lons) - Math.min(...lons)) * kmPerDegLon(lat0), 1.6);
  const scale = (HALF_WORLD * 2) / (spanKm * 1.15);
  const toWorld = (lat: number, lon: number): [number, number] => [(lon - lon0) * kmPerDegLon(lat0) * scale, -(lat - lat0) * KM_PER_DEG_LAT * scale];
  const heat: HeatPoint[] = heatRaw.map(([lat, lon, w]) => {
    const [x, z] = toWorld(lat, lon);
    return { x, z, w: Math.max(0, Math.min(1, w)), lat, lon };
  });
  const zone = taste.zone
    ? (() => {
        const [x, z] = toWorld(taste.zone.lat, taste.zone.lon);
        return { x, z, r: Math.max(3, Math.min(14, taste.zone.radiusKm * scale)), name: taste.zone.name, lat: taste.zone.lat, lon: taste.zone.lon, km: taste.zone.radiusKm };
      })()
    : null;
  return {
    title: src.title,
    city: src.destination?.name ?? "",
    sample: Boolean(src.sample),
    nodes: [],
    routes: [],
    heat,
    zone,
    extent: HALF_WORLD * 1.25,
    scale,
    center: { lat: lat0, lon: lon0 },
    origin: src.travel?.from && src.travel.origin ? { name: src.travel.origin, ...src.travel.from } : null,
    destination: src.destination ?? null,
    taste: taste.signals.length || taste.tags.length || taste.vibes.length ? { signals: [...taste.signals.map((s) => s.name), ...taste.tags.map((t) => t.name)].slice(0, 6), because: tasteBecause(taste), vibes: taste.vibes, scenes: taste.scenes, dishes: taste.dishes, audience: taste.audience, alsoLoved: taste.alsoLoved.map((x) => x.name).slice(0, 4) } : null,
    intel: src.intel ?? null,
    travel: src.travel ?? null,
    summary: null,
    stats: { places: 0, picked: 0, km: 0, match: null, xp: 0, days: 0 },
  };
}

/** "Because you love X, Y" or, when no taste was given, "What people who love Dubai go for". Pure. */
export function tasteBecause(t: { signals: { name: string; from?: string }[]; tags: { name: string }[] }): string {
  const place = t.signals.find((s) => s.from === "place");
  if (place && t.signals.length === 1 && t.tags.length === 0) return `What people who love ${place.name} go for`;
  const names = [...t.signals.map((s) => s.name), ...t.tags.map((x) => x.name)];
  return names.length ? `Because you love ${names.slice(0, 4).join(", ")}` : "";
}
