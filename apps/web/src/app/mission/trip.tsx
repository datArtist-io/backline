"use client";
// The planning agent's screens: what it found and why, the plan with travel between stops, the
// places it picked, what it's about to do, and what it did. Payments always stay with the user.
import { useEffect, useMemo, useRef, useState } from "react";
import TripMap, { DAY_COLORS, type MapDay, type TasteLayer } from "./TripMap";
import { TasteMatch } from "./Taste";
import type { ActionResult, Fact, Place, Profile, TasteOutput, TripAction, TripActionsOutput, TripAgentOutput, TripExecuteOutput, TripPlanOutput, TripRequest, TripRoutesOutput } from "@backline/engine";
import type { Evidence, StepResult } from "@/lib/mission-stream";
import { copyText, downloadFile, mailtoHref, slug } from "@/lib/actions";
import { buildIcs } from "@/lib/ics";
import { buildPptx, printDocument, saveBlob, slidesHtml, tripDocumentHtml, type ExportTrip } from "@/lib/export";
import { Notes, Receipts } from "./sections";

type R<T> = StepResult & { data: T };

const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString("en")} ${currency}`;
  }
};
const longDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : null);
const shortDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null);
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

export function tripChips(t: TripRequest, where?: TripAgentOutput["where"] | null): string[] {
  const place = where?.city ? [where.city.name, where.city.country].filter(Boolean).join(", ") : t.destination;
  const out = [place];
  if (t.startDate) out.push(t.endDate && t.endDate !== t.startDate ? `${shortDate(t.startDate)} – ${shortDate(t.endDate)}` : (shortDate(t.startDate) ?? ""));
  out.push(`${t.adults} ${t.adults === 1 ? "person" : "people"}`);
  if (t.budget.amount) out.push(`${money(t.budget.amount, t.budget.currency)}${t.budget.scope === "per_night" ? " a night" : ""}`);
  if (t.event) out.push(`${t.event.type}${t.event.guests ? ` · ${t.event.guests} guests` : ""}`);
  if (t.near) out.push(`Near ${where?.landmark?.name ?? t.near}`);
  if (t.travelMode) out.push(`By ${t.travelMode}${t.selfArranged.includes("transport") ? " (you're booking it)" : ""}`);
  if (t.inspiredBy) out.push(`Inspired by ${t.inspiredBy}`);
  return out.filter(Boolean);
}

// ---------- What the agent found ----------

export function AgentSummary({ result }: { result: R<TripAgentOutput> }) {
  const a = result.data;
  return (
    <section className="section" aria-labelledby="found-title">
      <h2 className="section-title" id="found-title">
        What I found
      </h2>
      {a.summary && <p className="lead">{a.summary}</p>}
      {a.questions.length > 0 && (
        <div className="lg asks">
          <p className="sub">Only you can decide</p>
          <ul>
            {a.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {a.facts.length > 0 && <ResearchNotes facts={a.facts} />}
      <Notes notes={result.notes} />
    </section>
  );
}

function ResearchNotes({ facts }: { facts: Fact[] }) {
  return (
    <details className="research">
      <summary>Research notes ({facts.length})</summary>
      <ul>
        {facts.map((f) => (
          <li key={f.id}>
            <span>{f.text}</span>{" "}
            {f.url && (
              <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="muted">
                {hostOf(f.url)}
              </a>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---------- The plan ----------

type RouteDay = TripRoutesOutput["days"][number];
type Arrival = { leg: RouteDay["legs"][number]; from: RouteDay["stops"][number] };

/** For each plan item, the leg that brings you there (if it's a new stop on the route). Pure. */
export function arrivals(items: TripPlanOutput["days"][number]["items"], route?: RouteDay): Map<number, Arrival> {
  const out = new Map<number, Arrival>();
  if (!route || route.legs.length === 0) return out;
  let pos = 0;
  items.forEach((it, k) => {
    if (!it.placeId) return;
    let j = pos;
    while (j < route.stops.length && (route.stops[j].implied || route.stops[j].id !== it.placeId)) j++;
    if (j >= route.stops.length) return;
    if (j > 0 && route.legs[j - 1]) out.set(k, { leg: route.legs[j - 1], from: route.stops[j - 1] });
    pos = j + 1;
  });
  return out;
}

function Travel({ a, back }: { a: Arrival; back?: string }) {
  const walk = a.leg.mode === "walk";
  const ride = a.leg.ride;
  return (
    <li className={`slot-travel${walk ? " is-walk" : " is-ride"}`} aria-label={`${walk ? "Walk" : "Ride"} ${mins(a.leg.minutes)}`}>
      <span className="slot-travel-line" aria-hidden="true" />
      <span className="travel-row">
      <span className="travel-chip">
        <span className="travel-ico" aria-hidden="true">
          {walk ? "🚶" : "🚕"}
        </span>
        {back ? `Back to ${back}: ` : ""}
        {walk ? "Walk" : "Ride"} {mins(a.leg.minutes)} · {a.leg.km} km{!back && a.from.implied ? ` from ${a.from.name}` : ""}
        {a.leg.estimated ? " (estimate)" : ""}
      </span>
      {ride && (
        <span className="travel-fare" title={`Estimate from ${ride.basis}. The app shows the live price.`}>
          {ride.provider} ≈ {money(ride.low, ride.currency)}–{money(ride.high, ride.currency).replace(/^[^\d]+/, "")}
        </span>
      )}
      {!walk &&
        a.leg.links?.map((l) => (
          <a key={l.label} className="travel-link" href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label}
          </a>
        ))}
      </span>
    </li>
  );
}

/** The plan, with its map: the map shows the selected day's route, and each day card can show its own. */
export function PlanSection({
  result,
  places,
  routes,
  mapRoutes,
  landmarkId,
  title,
  agent,
  taste,
}: {
  /** The taste profile from Qloo: its heatmap goes on the map and it's included in exports. */
  taste?: TasteOutput | null;
  /** The agent's result, for exports (hotel lanes, sources). */
  agent?: TripAgentOutput;
  result: R<TripPlanOutput>;
  places: Map<string, Place>;
  routes?: TripRoutesOutput;
  /** What the map draws: the routes once ready, the picked places before that. */
  mapRoutes?: TripRoutesOutput | null;
  landmarkId?: string | null;
  title: string;
}) {
  const p = result.data;
  const tasteLayer = useMemo<TasteLayer | null>(() => (taste && taste.heat.length ? { heat: taste.heat, zone: taste.zone } : null), [taste]);
  // Rides across all days, estimated from published fares, as their own budget line.
  const rideDays = (routes?.days ?? []).filter((d) => d.rides);
  const rides = rideDays.length ? { low: rideDays.reduce((n, d) => n + d.rides!.low, 0), high: rideDays.reduce((n, d) => n + d.rides!.high, 0), currency: rideDays[0].rides!.currency, count: rideDays.reduce((n, d) => n + d.rides!.count, 0) } : null;
  const total = p.budget.reduce((s, b) => (b.amount ? s + b.amount : s), 0) + (rides && rides.currency === (p.budget.find((b) => b.amount)?.currency ?? rides.currency) ? Math.round((rides.low + rides.high) / 2) : 0);
  const currency = p.budget.find((b) => b.amount)?.currency ?? rides?.currency;
  const firstRouted = routes?.days.find((d) => d.stops.length >= 2)?.index;
  const [day, setDay] = useState<MapDay>(firstRouted ?? "all");
  const mapRef = useRef<HTMLDivElement>(null);
  // When the routes arrive after the plan, start on the first day that has one.
  useEffect(() => {
    if (firstRouted != null) setDay((d) => (d === "all" ? firstRouted : d));
  }, [firstRouted]);
  const showDay = (i: number) => {
    setDay(i);
    const el = mapRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section className="section" aria-labelledby="plan-title">
      <h2 className="section-title" id="plan-title">
        The plan
      </h2>
      <p className="lead">{p.summary}</p>
      {agent && <ExportBar trip={{ title, chips: tripChips(agent.trip, agent.where), agent, plan: p, routes, places, taste }} />}
      {mapRoutes?.bounds && (
        <div ref={mapRef} className="plan-map">
          <TripMap routes={mapRoutes} landmarkId={landmarkId} title={title} active={day} onActive={setDay} embedded taste={tasteLayer} />
        </div>
      )}
      <ol className="days">
        {p.days.map((d, i) => {
          const route = routes?.days.find((r) => r.index === i);
          const arrive = arrivals(d.items, route);
          const last = route?.stops[route.stops.length - 1];
          const back = last?.implied && route && route.legs.length ? route.legs[route.legs.length - 1] : null;
          const mapped = Boolean(route && route.stops.length >= 2 && mapRoutes?.bounds);
          return (
            <li key={i} className={`lg day${mapped && day === i ? " is-on" : ""}`} style={{ ["--day" as string]: DAY_COLORS[i % DAY_COLORS.length] }}>
              <div className="day-head">
                <span className="day-n">Day {i + 1}</span>
                <span className="day-label">{d.label}</span>
                {d.date && <span className="day-date">{longDate(d.date)}</span>}
                {mapped && (
                  <button type="button" className="day-map" aria-pressed={day === i} onClick={() => showDay(i)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z M9 4v14 M15 6v14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                    {day === i ? "On the map" : "Show route"}
                  </button>
                )}
              </div>
              <ol className="slots">
                {d.items.map((it, j) => {
                  const place = it.placeId ? places.get(it.placeId) : undefined;
                  const a = arrive.get(j);
                  return [
                    a ? <Travel key={`t${j}`} a={a} /> : null,
                    <li key={j} className="slot">
                      <span className="slot-time">{it.time}</span>
                      <div className="slot-body">
                        <p className="slot-title">{it.title}</p>
                        {(it.note || place?.address) && <p className="slot-note">{[it.note, place?.address].filter(Boolean).join(" · ")}</p>}
                      </div>
                    </li>,
                  ];
                })}
                {back && last && route && <Travel a={{ leg: back, from: route.stops[route.stops.length - 2] ?? last }} back={last.name} />}
              </ol>
              {route && route.minutes > 0 && (
                <p className="day-travel muted small">
                  About {mins(route.minutes)} of travel, {route.km} km.
                  {route.rides ? ` ${route.rides.count} ride${route.rides.count === 1 ? "" : "s"}, about ${money(route.rides.low, route.rides.currency)}–${money(route.rides.high, route.rides.currency)}.` : ""}{" "}
                  {route.directions && (
                    <a href={route.directions} target="_blank" rel="noopener noreferrer">
                      Directions
                    </a>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {(p.budget.length > 0 || rides) && (
        <div className="lg budget">
          <p className="sub">Budget</p>
          <table>
            <tbody>
              {p.budget.map((b, i) => (
                <tr key={i}>
                  <th scope="row">{b.item}</th>
                  <td>{b.amount != null ? money(b.amount, b.currency) : "To confirm"}</td>
                  <td className="muted small">{b.basis}</td>
                </tr>
              ))}
              {rides && (
                <tr>
                  <th scope="row">
                    Rides ({rides.count})
                  </th>
                  <td>
                    {money(rides.low, rides.currency)}–{money(rides.high, rides.currency)}
                  </td>
                  <td className="muted small">Estimated from published ride fares; the app shows the live price.</td>
                </tr>
              )}
              {total > 0 && currency && (
                <tr className="total">
                  <th scope="row">Estimated total</th>
                  <td>{money(total, currency)}</td>
                  <td className="muted small">Estimates. Final prices are confirmed when booking.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {p.tips.length > 0 && (
        <ul className="lg takeaways">
          {p.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <Notes notes={result.notes} />
    </section>
  );
}

/** Take the plan anywhere: every item into a calendar, or a document, PDF or presentation. */
function ExportBar({ trip }: { trip: ExportTrip }) {
  const [done, setDone] = useState<string | null>(null);
  const name = slug(trip.title) || "plan";
  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(null), 2600);
  };
  const dated = trip.plan.days.some((d) => d.date);
  return (
    <div className="export-bar" role="group" aria-label="Save or share the plan">
      <button
        type="button"
        className="export-btn primary"
        disabled={!dated}
        title={dated ? "Every stop as a calendar event (Google, Apple, Outlook)" : "Add dates to the plan first"}
        onClick={() => {
          downloadFile(`${name}.ics`, buildIcs(trip.title, trip.plan, trip.places), "text/calendar;charset=utf-8");
          flash("Calendar file saved: open it to add every stop");
        }}
      >
        <span aria-hidden="true">▦</span> Add to calendar
      </button>
      <button type="button" className="export-btn" onClick={() => (printDocument(trip) ? flash("Choose “Save as PDF” in the print window") : flash("Allow pop-ups to save a PDF"))}>
        PDF
      </button>
      <button
        type="button"
        className="export-btn"
        onClick={() => {
          saveBlob(`${name}.doc`, new Blob([tripDocumentHtml(trip)], { type: "application/msword" }));
          flash("Document saved (opens in Word or Google Docs)");
        }}
      >
        Document
      </button>
      <button
        type="button"
        className="export-btn"
        onClick={() => {
          saveBlob(`${name}.pptx`, buildPptx(trip));
          flash("Presentation saved (PowerPoint, Keynote or Google Slides)");
        }}
      >
        Presentation
      </button>
      <button
        type="button"
        className="export-btn"
        onClick={() => {
          const w = window.open("", "_blank");
          if (!w) return flash("Allow pop-ups to open the slides");
          w.document.write(slidesHtml(trip));
          w.document.close();
        }}
      >
        Present now
      </button>
      {done && (
        <span className="export-done" role="status">
          {done}
        </span>
      )}
    </div>
  );
}

// ---------- Places ----------

const SOURCE_LABEL: Record<string, string> = { qloo: "Qloo", osm: "OpenStreetMap", "qloo+osm": "Qloo + OpenStreetMap", hotels: "Live rate" };

export function PlacesSection({ title, places, chosenId, anchor, notes, evidence }: { title: string; places: Place[]; chosenId?: string | null; anchor?: string | null; notes?: string[]; evidence?: Evidence[] }) {
  if (places.length === 0) return notes?.length ? <Notes notes={notes} /> : null;
  return (
    <section className="section" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <ul className="cards">
        {places.map((p) => (
          <li key={p.id} className={`lg card place${chosenId === p.id ? " winner" : ""}`}>
            {chosenId === p.id && <p className="card-meta">My pick</p>}
            <p className="card-title">{p.name}</p>
            <TasteMatch match={p.match} />
            {p.address && <p className="card-text">{p.address}</p>}
            <p className="place-facts">
              {p.distanceKm != null && <span>{p.distanceKm < 1 ? `${Math.round(p.distanceKm * 1000)} m` : `${p.distanceKm} km`}{anchor ? ` from ${anchor}` : ""}</span>}
              {p.rating != null && <span>★ {p.rating.toFixed(1)}</span>}
              {p.priceLevel != null && <span>{"$".repeat(Math.max(1, Math.min(4, Math.round(p.priceLevel))))}</span>}
              {p.offer && <span>{money(p.offer.total, p.offer.currency)} for your dates</span>}
              {!p.offer && p.rate && (
                <a href={p.rate.url} target="_blank" rel="noopener noreferrer nofollow">
                  {money(p.rate.perNight, p.rate.currency)} a night on {p.rate.site}
                </a>
              )}
              {!p.offer && !p.rate && p.priceNote && <span>{p.priceNote}</span>}
            </p>
            {p.why.length > 0 && <p className="card-text">{p.why.join(" · ")}</p>}
            {p.extra && <p className="card-text">{p.extra}</p>}
            <p className="place-contact">
              {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a>}
              {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
              {p.website && (
                <a href={p.website} target="_blank" rel="noopener noreferrer nofollow">
                  Website
                </a>
              )}
              {p.lat != null && p.lon != null && (
                <a href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`} target="_blank" rel="noopener noreferrer">
                  Map
                </a>
              )}
            </p>
            {p.source && <p className="place-source">{SOURCE_LABEL[p.source] ?? p.source}</p>}
          </li>
        ))}
      </ul>
      <Notes notes={notes} />
      {evidence && <Receipts evidence={evidence} />}
    </section>
  );
}

// ---------- Approve the actions ----------

const CHANNEL_ICON: Record<TripAction["channel"], string> = { email: "✉", call: "☎", link: "↗", calendar: "▦", reserve: "⌂" };

export function ActionsCheckpoint({
  actions,
  profile,
  busy,
  onConfirm,
}: {
  actions: TripAction[];
  profile: Profile;
  busy: boolean;
  onConfirm: (ids: string[], profile: Profile) => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => actions.filter((a) => a.recommended).map((a) => a.id));
  const [me, setMe] = useState<Profile>({ name: profile.name, email: profile.email, phone: profile.phone });
  const needsDetails = actions.some((a) => picked.includes(a.id) && a.mode === "auto");
  const missing = needsDetails && (!me.name?.trim() || !me.email?.trim());
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <section className="lg checkpoint" aria-labelledby="cp-actions">
      <p className="eyebrow">Your call</p>
      <h2 id="cp-actions" className="cp-title">
        Here&rsquo;s what I&rsquo;ll do. Good to go?
      </h2>
      <p className="muted">Untick anything you&rsquo;d rather handle yourself. I never pay or share card details.</p>
      <ul className="action-list">
        {actions.map((a) => {
          const on = picked.includes(a.id);
          return (
            <li key={a.id}>
              <button type="button" className={`action-row${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(a.id)}>
                <span className="action-icon" aria-hidden="true">
                  {CHANNEL_ICON[a.channel]}
                </span>
                <span className="cp-text">
                  <span className="cp-label">{a.title}</span>
                  <span className="cp-detail">
                    {a.channel === "reserve" && `I'll hold this rate${a.price ? ` (${money(a.price.total, a.price.currency)} total)` : ""}. You pay on the provider's secure page to confirm.`}
                    {a.channel === "email" && (a.mode === "auto" ? `I'll email ${a.to}` : `Opens a ready email to ${a.to}`)}
                    {a.channel === "call" && (a.mode === "auto" ? `I'll call ${a.to}` : `Number and script for ${a.to}`)}
                    {a.channel === "link" && "Opens with your dates and guests filled in. You pay there."}
                    {a.channel === "calendar" && "Every stop, in your calendar"}
                  </span>
                </span>
                <span className="cp-check" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {needsDetails && (
        <div className="me">
          <p className="sub">Who I&rsquo;m booking for</p>
          <div className="me-row">
            <input aria-label="Your name" placeholder="Your name" value={me.name ?? ""} onChange={(e) => setMe({ ...me, name: e.target.value })} maxLength={80} autoComplete="name" />
            <input aria-label="Your email" placeholder="Email for replies" type="email" value={me.email ?? ""} onChange={(e) => setMe({ ...me, email: e.target.value })} maxLength={254} autoComplete="email" />
            <input aria-label="Your phone" placeholder="Phone (optional)" type="tel" value={me.phone ?? ""} onChange={(e) => setMe({ ...me, phone: e.target.value })} maxLength={30} autoComplete="tel" />
          </div>
        </div>
      )}
      <div className="cp-foot">
        <span className="muted small">
          {picked.length} of {actions.length} selected
        </span>
        <button type="button" className="go" disabled={busy || picked.length === 0 || missing} onClick={() => onConfirm(picked, { ...profile, ...me })}>
          {busy ? "Working…" : "Do it"}
        </button>
      </div>
    </section>
  );
}

// ---------- What the agent did ----------

export function ResultsSection({
  title,
  actions,
  execute,
  plan,
  places,
}: {
  title: string;
  actions: TripActionsOutput;
  execute: R<TripExecuteOutput>;
  plan?: TripPlanOutput;
  places: Map<string, Place>;
}) {
  const byId = useMemo(() => new Map(actions.actions.map((a) => [a.id, a])), [actions]);
  const done = execute.data.results.filter((r) => r.status === "sent" || r.status === "calling" || r.status === "held" || r.status === "booked").length;
  return (
    <section className="section" aria-labelledby="done-title">
      <h2 className="section-title" id="done-title">
        {done > 0 ? "Done. Here's where things stand" : "Ready for you"}
      </h2>
      <ul className="results">
        {execute.data.results.map((r) => {
          const a = byId.get(r.actionId);
          return a ? <ResultRow key={r.actionId} a={a} r={r} title={title} plan={plan} places={places} /> : null;
        })}
      </ul>
    </section>
  );
}

const STATUS_LABEL: Record<ActionResult["status"], string> = {
  sent: "Sent",
  calling: "Calling",
  ready: "Your turn",
  needs_info: "Needs your details",
  failed: "Didn't work",
  skipped: "Skipped",
  held: "Held for you",
  booked: "Booked",
};

function ResultRow({ a, r, title, plan, places }: { a: TripAction; r: ActionResult; title: string; plan?: TripPlanOutput; places: Map<string, Place> }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className={`lg result is-${r.status}`}>
      <span className="action-icon" aria-hidden="true">
        {CHANNEL_ICON[a.channel]}
      </span>
      <div className="result-body">
        <p className="cp-label">
          {a.title} <span className={`status s-${r.status}`}>{STATUS_LABEL[r.status]}</span>
        </p>
        <p className="cp-detail">{r.message}</p>
        {r.status === "calling" && r.ref && <CallTracker id={r.ref} />}
        <div className="acts">
          {r.checkoutUrl && (
            <a className="act act-primary" href={r.checkoutUrl} target="_blank" rel="noopener noreferrer">
              Pay securely to confirm
            </a>
          )}
          {a.channel === "link" && a.url && (
            <a className="act" href={a.url} target="_blank" rel="noopener noreferrer">
              Open and book
            </a>
          )}
          {a.channel === "email" && r.status !== "sent" && a.to && a.subject && a.body && (
            <a className="act" href={mailtoHref(a.subject, a.body, a.to)}>
              Open in your email
            </a>
          )}
          {a.channel === "call" && r.status !== "calling" && a.to && (
            <>
              <a className="act" href={`tel:${a.to}`}>
                Call {a.to}
              </a>
              <button
                type="button"
                className="act"
                onClick={async () => {
                  if (await copyText(`${a.callOpening}\n\n${a.callBrief}`)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
              >
                {copied ? "Copied" : "Copy what to say"}
              </button>
            </>
          )}
          {a.channel === "calendar" && plan && (
            <button type="button" className="act" onClick={() => downloadFile(`${slug(title)}.ics`, buildIcs(title, plan, places), "text/calendar;charset=utf-8")}>
              Add to calendar
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

type CallState = { status: string; ended: boolean; summary: string | null; transcript: string | null; endedReason: string | null };

/** Follows a live AI call until it ends, then shows what was agreed. */
function CallTracker({ id }: { id: string }) {
  const [s, setS] = useState<CallState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let stop = false;
    let n = 0;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/calls/${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Couldn't check the call.");
        setS(data);
        setErr(null);
        if (data.ended) return;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't check the call.");
      }
      // Every 4 s for about 10 minutes.
      if (++n < 150) setTimeout(tick, 4000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [id]);
  if (err && !s) return <p className="muted small">{err}</p>;
  if (!s) return <p className="muted small">Connecting…</p>;
  return (
    <div className="call">
      <p className="call-status">
        <span className={`call-dot${s.ended ? " ended" : ""}`} aria-hidden="true" />
        {s.ended ? "Call finished" : s.status === "in-progress" ? "On the call now" : s.status === "ringing" ? "Ringing" : "Placing the call"}
      </p>
      {s.summary && <p className="call-summary">{s.summary}</p>}
      {s.ended && !s.summary && s.endedReason && <p className="muted small">Ended: {s.endedReason.replace(/[-_]/g, " ")}</p>}
      {s.transcript && (
        <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="pitch-facts">
          <summary>Transcript</summary>
          <pre className="transcript">{s.transcript}</pre>
        </details>
      )}
    </div>
  );
}
