// Routes for the plan: each day's stops in order, joined by real road routes with the distance and
// time of every leg, ready to draw on a map. Days after the first start and end at the hotel.
// If the routing service doesn't answer, straight lines with estimated times are used instead.
import { z } from "zod";
import type { BriefInput, Skill, SkillContext } from "../types";
import { distanceKm } from "../location";
import { agentOf, type TripPlanOutput } from "./trip";
import { arrivalMode, isArrivalStop, type TripAgentOutput } from "./trip-agent";
import { WALK_KM, rideFare, rideLinks, rideSchema, uberServes } from "./rides";

const stopSchema = z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number(), time: z.string(), kind: z.string(), implied: z.boolean() });
const legSchema = z.object({
  from: z.number(),
  to: z.number(),
  km: z.number(),
  minutes: z.number(),
  mode: z.enum(["drive", "walk"]),
  estimated: z.boolean(),
  /** For a ride: an estimated fare and buttons that open ride apps. */
  ride: rideSchema.nullable().optional(),
  links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
});
const placeRef = z.object({ name: z.string(), lat: z.number(), lon: z.number() });

const routesOutput = z.object({
  days: z.array(
    z.object({
      index: z.number(),
      date: z.string().nullable(),
      label: z.string(),
      stops: z.array(stopSchema),
      legs: z.array(legSchema),
      /** [lat, lon] pairs along the roads (or straight lines when estimated). */
      path: z.array(z.tuple([z.number(), z.number()])),
      km: z.number(),
      minutes: z.number(),
      /** Opens the day's route in Google Maps (phone or desktop). */
      directions: z.string().nullable(),
      /** Estimated ride spend for the day, when fares are known. */
      rides: z.object({ low: z.number(), high: z.number(), currency: z.string(), count: z.number() }).nullable().optional(),
    })
  ),
  /** The journey there and back: home to the destination (arrival station or airport) and home again. */
  journey: z.object({ mode: z.string(), from: placeRef, to: placeRef, km: z.number() }).nullable().optional(),
  /** Every place worth showing on the map, picked or not. */
  points: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number(), kind: z.string(), picked: z.boolean() })),
  /** [south, west, north, east] around everything. */
  bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  provider: z.enum(["roads", "estimate", "none"]),
});
export type TripRoutesOutput = z.infer<typeof routesOutput>;

type Located = { id: string; name: string; lat: number; lon: number; kind: string };

/** Every place in the agent's result that has coordinates, by id. Pure. */
export function locatedPlaces(a: Pick<TripAgentOutput, "stays" | "dines" | "venues" | "activities" | "stops">): Map<string, Located> {
  const out = new Map<string, Located>();
  for (const [kind, list] of [["stay", a.stays], ["dine", a.dines], ["venue", a.venues], ["activity", a.activities]] as const)
    for (const p of list) if (p.lat != null && p.lon != null) out.set(p.id, { id: p.id, name: p.name, lat: p.lat, lon: p.lon, kind });
  for (const s of a.stops) out.set(s.id, { id: s.id, name: s.name, lat: s.lat, lon: s.lon, kind: "stop" });
  return out;
}

/** The day's stops in order: consecutive repeats removed; later days start and end at the hotel. Pure. */
export function dayStops(day: TripPlanOutput["days"][number], index: number, total: number, located: Map<string, Located>, hotelId: string | null): z.infer<typeof stopSchema>[] {
  const stops: z.infer<typeof stopSchema>[] = [];
  for (const it of day.items) {
    const p = it.placeId ? located.get(it.placeId) : undefined;
    if (!p) continue;
    if (stops.length && stops[stops.length - 1].id === p.id) continue;
    stops.push({ ...p, time: it.time, implied: false });
  }
  const hotel = hotelId ? located.get(hotelId) : undefined;
  if (hotel && stops.length > 0) {
    if (index > 0 && stops[0].id !== hotel.id) stops.unshift({ ...hotel, time: "", implied: true });
    if (index < total - 1 && stops[stops.length - 1].id !== hotel.id) stops.push({ ...hotel, time: "", implied: true });
  }
  return stops.slice(0, 10);
}

const WALK_KMH = 4.8;
const CITY_KMH = 22;

/** Straight-line legs with honest estimates (roads are ~30% longer than the crow flies). Pure. */
export function estimateLegs(stops: { lat: number; lon: number }[]): z.infer<typeof legSchema>[] {
  return stops.slice(1).map((b, i) => {
    const km = Math.round(distanceKm(stops[i], b) * 1.3 * 10) / 10;
    const walk = km < WALK_KM;
    return { from: i, to: i + 1, km, minutes: Math.max(1, Math.round((km / (walk ? WALK_KMH : CITY_KMH)) * 60)), mode: walk ? "walk" : "drive", estimated: true };
  });
}

/** A Google Maps directions link through the stops. Pure. */
export function directionsUrl(stops: { lat: number; lon: number }[]): string | null {
  if (stops.length < 2) return null;
  const pt = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const q = new URLSearchParams({ api: "1", origin: pt(stops[0]), destination: pt(stops[stops.length - 1]), travelmode: "driving" });
  const mid = stops.slice(1, -1).slice(0, 8);
  if (mid.length) q.set("waypoints", mid.map(pt).join("|"));
  return `https://www.google.com/maps/dir/?${q}`;
}

async function roadRoute(ctx: SkillContext, stops: z.infer<typeof stopSchema>[]) {
  if (!ctx.osm || stops.length < 2) return null;
  try {
    const r = await ctx.osm.route(stops, "car", { signal: ctx.signal });
    ctx.usage.add("maps", 1);
    if (r.legs.length !== stops.length - 1) return null;
    const legs = r.legs.map((l, i) => {
      // Short hops are walks; walking time beats a car crawling round the block.
      const walk = l.km < WALK_KM;
      return { from: i, to: i + 1, km: l.km, minutes: walk ? Math.max(1, Math.round((l.km / WALK_KMH) * 60)) : l.minutes, mode: walk ? ("walk" as const) : ("drive" as const), estimated: false };
    });
    return { legs, path: r.path.length >= 2 ? r.path : stops.map((s) => [s.lat, s.lon] as [number, number]) };
  } catch (err) {
    ctx.log.warn("Routing failed; using estimates", { error: String(err) });
    return null;
  }
}

/**
 * A one-day outline from the agent's picks, for when there's no written plan: arrive, check in,
 * the landmark (or hosted venue), dinner. Pure.
 */
export function outlineDay(a: Pick<TripAgentOutput, "picks" | "stops" | "trip">): TripPlanOutput["days"][number] {
  const arrival = a.stops.find(isArrivalStop);
  const landmark = a.stops.find((s) => s.kind === "landmark") ?? null;
  const items = [
    arrival ? { time: "11:00", title: `Arrive at ${arrival.name}`, placeId: arrival.id, note: null } : null,
    a.picks.stays[0] ? { time: "13:00", title: "Check in", placeId: a.picks.stays[0], note: null } : null,
    a.trip.event && a.picks.venues[0] ? { time: "18:00", title: a.trip.event.type, placeId: a.picks.venues[0], note: null } : landmark ? { time: "17:30", title: landmark.name, placeId: landmark.id, note: null } : null,
    a.picks.dines[0] ? { time: "20:30", title: "Dinner", placeId: a.picks.dines[0], note: null } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);
  return { date: a.trip.startDate, label: "Arrive", items };
}

/** Each ride leg with a fare range and app buttons; walks stay walks. Pure. */
export function withRides(legs: z.infer<typeof legSchema>[], stops: { lat: number; lon: number; name: string }[], where: string): z.infer<typeof legSchema>[] {
  return legs.map((l) => (l.mode === "walk" ? l : { ...l, ride: rideFare(l.km, l.minutes, where), links: rideLinks(stops[l.from], stops[l.to], where) }));
}

/** Most Uber lookups for one mission: each is a live call, and the pages only need the legs people will ride. */
const UBER_LOOKUPS = 12;

/**
 * Swaps the published-rate estimate for Uber's live price on each ride leg, where Uber runs and
 * the keys are production keys. A leg Uber cannot price keeps its estimate. Never throws.
 */
export async function withLiveFares(ctx: SkillContext, legs: z.infer<typeof legSchema>[], stops: { lat: number; lon: number; name: string }[], where: string, budget: { left: number }): Promise<z.infer<typeof legSchema>[]> {
  const uber = ctx.uber;
  if (!uber || !uberServes(where)) return legs;
  return Promise.all(
    legs.map(async (l) => {
      if (l.mode === "walk" || budget.left <= 0) return l;
      budget.left -= 1;
      try {
        const fare = await uber.estimate(stops[l.from], stops[l.to], ctx.signal);
        return fare ? { ...l, ride: { provider: "Uber", low: fare.low, high: fare.high, currency: fare.currency, basis: `Uber's own price estimate for ${fare.product} when this trip was planned; it can change with demand` } } : l;
      } catch {
        return l;
      }
    })
  );
}

/** Home to the destination and back, when the user's home city is known and it's somewhere else. */
async function roundTrip(ctx: SkillContext, a: TripAgentOutput, input: BriefInput): Promise<TripRoutesOutput["journey"]> {
  const home = input.profile?.homeCity?.trim();
  const mode = arrivalMode(a.trip) ?? (a.trip.travelMode ? "car" : null);
  if (!home || !mode || !ctx.osm) return null;
  const arrival = a.stops.find(isArrivalStop);
  const to = arrival ? { name: arrival.name, lat: arrival.lat, lon: arrival.lon } : a.where.city ? { name: a.where.city.name, lat: a.where.city.lat, lon: a.where.city.lon } : null;
  if (!to) return null;
  try {
    const hit = (await ctx.osm.geocode(home, { limit: 1, signal: ctx.signal }))[0];
    if (!hit) return null;
    const km = Math.round(distanceKm(hit, to));
    if (km < 15) return null;
    return { mode, from: { name: hit.name, lat: hit.lat, lon: hit.lon }, to, km };
  } catch {
    return null;
  }
}

export const tripRoutes: Skill<BriefInput, TripRoutesOutput> = {
  id: "trip.routes",
  title: "Mapping your routes",
  dependsOn: ["trip.agent"],
  // Routes follow the written plan; if it couldn't be written, they follow the agent's picks.
  optionalDeps: ["trip.plan"],
  timeoutMs: 40_000,
  output: routesOutput,
  async run(ctx, input, deps) {
    const a = agentOf(deps);
    const written = deps["trip.plan"]?.data as TripPlanOutput | undefined;
    const plan: Pick<TripPlanOutput, "days" | "stayId"> = written ?? { days: [outlineDay(a)], stayId: a.picks.stays[0] ?? null };
    const located = locatedPlaces(a);
    const where = [a.where.city?.countryCode, a.where.city?.display, a.trip.destination].filter(Boolean).join(" ");
    const hotelId = plan.stayId ?? a.picks.stays[0] ?? null;
    let usedRoads = false;
    let anyDay = false;
    const uberBudget = { left: UBER_LOOKUPS };
    let roadsOk = true;
    const roadsUntil = Date.now() + 25_000;
    const days: TripRoutesOutput["days"] = [];
    for (const [i, d] of plan.days.entries()) {
      const stops = dayStops(d, i, plan.days.length, located, hotelId);
      if (stops.length < 2) {
        days.push({ index: i, date: d.date, label: d.label, stops, legs: [], path: stops.map((s) => [s.lat, s.lon]), km: 0, minutes: 0, directions: null });
        continue;
      }
      anyDay = true;
      // One slow or down routing server mustn't sink every day: after a miss, or 25 s in, estimate the rest.
      const road = roadsOk && Date.now() < roadsUntil ? await roadRoute(ctx, stops) : null;
      if (road) usedRoads = true;
      else roadsOk = false;
      const legs = await withLiveFares(ctx, withRides(road?.legs ?? estimateLegs(stops), stops, where), stops, where, uberBudget);
      // One currency per day: a day cannot add up fares quoted in two.
      const currency = legs.find((l) => l.ride)?.ride?.currency;
      const priced = legs.filter((l) => l.ride && l.ride.currency === currency);
      days.push({
        index: i,
        date: d.date,
        label: d.label,
        stops,
        legs,
        path: road?.path ?? stops.map((s) => [s.lat, s.lon]),
        km: Math.round(legs.reduce((sum, l) => sum + l.km, 0) * 10) / 10,
        minutes: legs.reduce((sum, l) => sum + l.minutes, 0),
        directions: directionsUrl(stops),
        rides: priced.length ? { low: priced.reduce((n, l) => n + l.ride!.low, 0), high: priced.reduce((n, l) => n + l.ride!.high, 0), currency: priced[0].ride!.currency, count: priced.length } : null,
      });
    }
    const journey = await roundTrip(ctx, a, input);

    const picked = new Set([...a.picks.stays, ...a.picks.dines, ...a.picks.venues, ...a.picks.activities, ...a.stops.map((s) => s.id), ...(plan.stayId ? [plan.stayId] : [])]);
    const points = [...located.values()].map((p) => ({ ...p, picked: picked.has(p.id) }));
    const coords: [number, number][] = [...points.map((p) => [p.lat, p.lon] as [number, number]), ...days.flatMap((d) => d.path)];
    const bounds: TripRoutesOutput["bounds"] = coords.length
      ? [Math.min(...coords.map((c) => c[0])), Math.min(...coords.map((c) => c[1])), Math.max(...coords.map((c) => c[0])), Math.max(...coords.map((c) => c[1]))]
      : null;
    const notes = anyDay && !usedRoads ? ["Road routing didn't answer, so travel times are estimates."] : [];
    return {
      data: { days, points, bounds, provider: !anyDay ? "none" : usedRoads ? "roads" : "estimate", journey },
      evidence: usedRoads ? [{ source: "derived", label: "Routes", basis: "Road routing on OpenStreetMap data (OSRM)" }] : [],
      notes,
    };
  },
};
