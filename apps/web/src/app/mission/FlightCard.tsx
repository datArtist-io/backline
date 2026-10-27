"use client";
// The flight the agent chose (and booked, once it has): airline, times there and back, stops and
// the price paid.
import type { TripFlightsOutput } from "@backline/engine";

type Leg = NonNullable<TripFlightsOutput["flight"]>["outbound"];

const time = (iso: string) => (iso ? iso.slice(11, 16) : "");
const day = (iso: string) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "");
const dur = (m: number | null) => (m == null ? "" : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`);
const money = (n: number, c: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: c, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString("en")} ${c}`;
  }
};

function LegRow({ leg, label }: { leg: Leg; label: string }) {
  return (
    <div className="fl-leg">
      <span className="fl-label">{label}</span>
      <span className="fl-day">{day(leg.departs)}</span>
      <div className="fl-route">
        <span className="fl-end">
          <strong>{time(leg.departs)}</strong>
          <span>{leg.from}</span>
        </span>
        <span className="fl-line" aria-hidden="true">
          <span className="fl-plane">✈</span>
        </span>
        <span className="fl-end is-to">
          <strong>{time(leg.arrives)}</strong>
          <span>{leg.to}</span>
        </span>
      </div>
      <span className="fl-meta">
        {[leg.carrier, leg.flight, dur(leg.minutes), leg.stops === 0 ? "Direct" : `${leg.stops} stop${leg.stops > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

export default function FlightCard({ data, booked }: { data: TripFlightsOutput; booked?: { ref: string | null; message: string } | null }) {
  const f = data.flight;
  if (!f) return null;
  return (
    <section className="section" aria-labelledby="flight-title">
      <div className="lg fl-card">
        <div className="fl-head">
          <div>
            <span className="fl-kicker">{booked ? "Booked and paid" : "Your flight"}</span>
            <h2 className="fl-title" id="flight-title">
              {data.from?.split(" (")[0]} to {data.to?.split(" (")[0]}
            </h2>
          </div>
          <div className="fl-price">
            <strong>{money(f.total, f.currency)}</strong>
            <span>{f.inbound ? "return, all taxes" : "one way, all taxes"}</span>
          </div>
        </div>
        <LegRow leg={f.outbound} label="Out" />
        {f.inbound && <LegRow leg={f.inbound} label="Back" />}
        <p className="fl-foot">
          {booked?.ref ? <span className="fl-ref">Booking reference {booked.ref}</span> : <span>Chosen from {data.compared} fares: a sensible journey time at the best price.</span>}
        </p>
      </div>
    </section>
  );
}
