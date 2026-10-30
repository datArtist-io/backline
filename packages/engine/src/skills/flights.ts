// Getting there: when the trip starts in another city, find the flights there and back for the
// trip's dates and choose one (a sensible journey time at the best price, direct when it costs
// little more). Runs alongside the agent's search so it adds no waiting.
import { z } from "zod";
import type { BriefInput, Skill, TripRequest } from "../types";
import { bestFlight, type FlightOffer } from "../clients/duffel";

const legSchema = z.object({ from: z.string(), fromName: z.string().nullable(), to: z.string(), toName: z.string().nullable(), departs: z.string(), arrives: z.string(), carrier: z.string().nullable(), flight: z.string().nullable(), stops: z.number(), minutes: z.number().nullable() });
export const flightSchema = z.object({
  offerId: z.string(),
  passengerIds: z.array(z.string()),
  airline: z.string().nullable(),
  total: z.number(),
  currency: z.string(),
  outbound: legSchema,
  inbound: legSchema.nullable(),
  refundable: z.boolean().nullable(),
  documentsRequired: z.boolean().optional(),
});

const flightsOutput = z.object({
  flight: flightSchema.nullable(),
  /** How many fares were compared. */
  compared: z.number(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** Duffel test mode: bookings are on a test airline and no money moves. */
  sandbox: z.boolean(),
});
export type TripFlightsOutput = z.infer<typeof flightsOutput>;

const GROUND = /\b(?:train|bus|car|drive|driving|road|ferry|boat)\b/i;

/** Where the trip starts, if it needs a flight at all: not when they're going by road or arranging travel themselves. Pure. */
export function flightOrigin(t: Pick<TripRequest, "origin" | "travelMode" | "selfArranged" | "destination" | "startDate">, homeCity?: string): string | null {
  if (!t.startDate || !t.destination) return null;
  if (t.travelMode && GROUND.test(t.travelMode)) return null;
  if (t.selfArranged.includes("transport")) return null;
  const origin = (t.origin ?? homeCity ?? "").trim();
  if (!origin) return null;
  const city = (x: string) => x.split(",")[0].trim().toLowerCase();
  return city(origin) === city(t.destination) ? null : origin;
}

export const tripFlights: Skill<BriefInput, TripFlightsOutput> = {
  id: "trip.flights",
  title: "Finding flights",
  dependsOn: [],
  timeoutMs: 45_000,
  output: flightsOutput,
  async run(ctx, input) {
    const t = input.trip;
    const none = (notes: string[] = []) => ({ data: { flight: null, compared: 0, from: null, to: null, sandbox: Boolean(ctx.flights?.sandbox) }, evidence: [], notes });
    if (!t || !ctx.flights) return none();
    // Duffel's test airline returns made-up flights and fares. Never show those as a real option; the "getting there" step covers it.
    if (ctx.flights.sandbox) return none();
    const origin = flightOrigin(t, input.profile?.homeCity);
    if (!origin) return none();
    ctx.progress?.({ kind: "act", id: "fl.find", tool: "flights", text: `Finding flights from ${origin} to ${t.destination}`, by: "autopilot" });
    const t0 = Date.now();
    const [from, to] = await Promise.all([ctx.flights.airport(origin, ctx.signal), ctx.flights.airport(t.destination, ctx.signal)]);
    if (!from || !to || from.code === to.code) return none(from && to ? [] : [`I couldn't find an airport for ${!from ? origin : t.destination}.`]);
    const offers: FlightOffer[] = await ctx.flights.search({ from: from.code, to: to.code, depart: t.startDate!, back: t.endDate && t.endDate !== t.startDate ? t.endDate : null, adults: t.adults, signal: ctx.signal });
    ctx.usage.add("flights", 1);
    const flight = bestFlight(offers);
    ctx.progress?.({ kind: "saw", id: "fl.find", tool: "flights", ok: Boolean(flight), text: flight ? `Compared ${offers.length} fares; chose ${flight.airline ?? "the best one"} at ${Math.round(flight.total).toLocaleString("en")} ${flight.currency}` : "No flights found for those dates", ms: Date.now() - t0, by: "autopilot" });
    return {
      data: { flight, compared: offers.length, from: `${from.name} (${from.code})`, to: `${to.name} (${to.code})`, sandbox: ctx.flights.sandbox },
      evidence: [],
      notes: flight ? [] : [`No flights from ${from.name} to ${to.name} on those dates.`],
    };
  },
};
