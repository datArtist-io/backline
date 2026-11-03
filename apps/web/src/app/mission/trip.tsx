"use client";
// The planning agent's screens: what it found and why, the plan with travel between stops, the
// places it picked, what it's about to do, and what it did.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useWallet, walletMoney } from "./Wallet";
import TripMap, { DAY_COLORS, type MapDay, type TasteLayer } from "./TripMap";
import { TasteMatch } from "./Taste";
import type { ActionResult, Fact, Place, Profile, TasteOutput, TripAction, TripActionsOutput, TripAgentOutput, TripExecuteOutput, TripPlanOutput, TripRequest, TripRoutesOutput } from "@backline/engine";
import type { Evidence, StepResult } from "@/lib/mission-stream";
import { copyText, downloadFile, mailtoHref, slug } from "@/lib/actions";
import { buildIcs } from "@/lib/ics";
import { buildPptx, outline, printDocument, saveBlob, slidesHtml, tripDocumentHtml, type ExportTrip } from "@/lib/export";
import { EMAIL_MAX, mailtoUrl, plainText, telegramUrl, tripMessage, whatsappUrl, type ShareTrip } from "@/lib/share";
import { Notes, Receipts } from "./sections";
import { formatMoney } from "@/lib/currency";

type R<T> = StepResult & { data: T };

const money = (n: number, currency: string) => formatMoney(n, currency);
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

/** "Guéliz ⵜⴳⵍⵉⵣ گليز" → "Guéliz": map names often carry every local script; keep the one being read. Pure. */
export function oneScript(name: string): string {
  if (!/\p{Script=Latin}/u.test(name)) return name;
  const kept = name.split(/\s+/).filter((w) => !/\p{L}/u.test(w) || /\p{Script=Latin}/u.test(w));
  return kept.join(" ").replace(/\s*[-–,/]\s*$/, "").trim() || name;
}

export function tripChips(t: TripRequest, where?: TripAgentOutput["where"] | null): string[] {
  const place = where?.city ? [where.city.name, where.city.country].filter(Boolean).join(", ") : t.destination;
  const out = [place];
  if (t.startDate) out.push(t.endDate && t.endDate !== t.startDate ? `${shortDate(t.startDate)} – ${shortDate(t.endDate)}` : (shortDate(t.startDate) ?? ""));
  out.push(`${t.adults} ${t.adults === 1 ? "person" : "people"}`);
  if (t.budget.amount) out.push(`${money(t.budget.amount, t.budget.currency)}${t.budget.scope === "per_night" ? " a night" : ""}`);
  if (t.event) out.push(`${t.event.type}${t.event.guests ? ` · ${t.event.guests} guests` : ""}`);
  if (t.near) out.push(`Near ${oneScript(where?.landmark?.name ?? t.near)}`);
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
                  {/* With a line still "To confirm" (often the hotel), the sum is only part of the cost: say so. */}
                  <th scope="row">{p.budget.some((b) => b.amount == null) ? "Priced so far" : "Estimated total"}</th>
                  <td>{money(total, currency)}</td>
                  <td className="muted small">{p.budget.some((b) => b.amount == null) ? `Not including ${p.budget.filter((b) => b.amount == null).map((b) => b.item.toLowerCase()).join(", ")}, still to confirm.` : "Estimates. Final prices are confirmed when booking."}</td>
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
      <CalendarMenu trip={trip} name={name} dated={dated} flash={flash} />
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
      <SendPlan trip={trip} flash={flash} />
      {done && (
        <span className="export-done" role="status">
          {done}
        </span>
      )}
    </div>
  );
}

/** Closes a dropdown on a click elsewhere or Escape, so it never lingers over the plan. */
function useCloseAway(menu: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const away = (e: Event) => {
      const el = menu.current;
      if (el?.open && !(e instanceof KeyboardEvent ? e.key !== "Escape" : el.contains(e.target as Node))) el.open = false;
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", away);
    };
  }, [menu]);
}

/**
 * Into the traveller's calendar. Signed in, Google or Apple/Outlook subscribe to their private Backline
 * calendar once, and every trip they plan after that appears by itself. Signed out, it saves a file.
 */
function CalendarMenu({ trip, name, dated, flash }: { trip: ExportTrip; name: string; dated: boolean; flash: (msg: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  useCloseAway(menu);
  const file = () => downloadFile(`${name}.ics`, buildIcs(trip.title, trip.plan, trip.places), "text/calendar;charset=utf-8");
  const subscribe = async (app: "google" | "apple") => {
    if (menu.current) menu.current.open = false;
    // Open the tab now, while the click still counts, so the browser doesn't block it after the wait.
    const tab = app === "google" ? window.open("about:blank", "_blank") : null;
    setBusy(true);
    try {
      const res = await fetch("/api/calendar", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; google?: string; webcal?: string; reason?: string };
      if (res.ok && body.ok && body.google && body.webcal) {
        if (app === "google") {
          if (tab) tab.location.href = body.google;
          else window.location.href = body.google;
          return flash("Add the calendar in Google: your trips will keep in sync");
        }
        window.location.href = body.webcal;
        return flash("Subscribe in your calendar app: your trips will keep in sync");
      }
      tab?.close();
      file();
      flash(res.status === 401 ? "Calendar file saved. Sign in to keep trips in sync" : "Calendar file saved");
    } catch {
      tab?.close();
      file();
      flash("Calendar file saved");
    } finally {
      setBusy(false);
    }
  };
  if (!dated)
    return (
      <button type="button" className="export-btn primary" disabled title="Add dates to the plan first">
        <span aria-hidden="true">▦</span> Calendar
      </button>
    );
  return (
    <details className="send-plan" ref={menu}>
      <summary className="export-btn primary" aria-label="Add the plan to your calendar">
        <span aria-hidden="true">▦</span> {busy ? "Connecting…" : "Calendar"} <span aria-hidden="true" className="send-caret">▾</span>
      </summary>
      <div className="send-menu" role="menu">
        <button type="button" role="menuitem" disabled={busy} onClick={() => void subscribe("google")}>
          Google Calendar
        </button>
        <button type="button" role="menuitem" disabled={busy} onClick={() => void subscribe("apple")}>
          Apple or Outlook
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            if (menu.current) menu.current.open = false;
            file();
            flash("Calendar file saved: open it to add every stop");
          }}
        >
          Download file
        </button>
      </div>
    </details>
  );
}

/** Send the whole plan to WhatsApp, Telegram or your inbox, ready to keep or pass on. */
function SendPlan({ trip, flash }: { trip: ExportTrip; flash: (msg: string) => void }) {
  const [sending, setSending] = useState(false);
  const site = typeof window === "undefined" ? "" : window.location.origin;
  const share = (): ShareTrip => {
    const o = outline(trip);
    return { title: trip.title, chips: trip.chips, summary: o.summary, days: o.days, budget: o.budget, tips: o.tips };
  };
  const open = (url: string) => {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) window.location.href = url;
  };
  const email = async () => {
    const subject = `Your Backline trip: ${trip.title}`.slice(0, 160);
    const text = plainText(tripMessage(share(), site, EMAIL_MAX));
    setSending(true);
    try {
      const res = await fetch("/api/share/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, text }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; to?: string; reason?: string };
      if (res.ok && body.ok) return flash(`Sent to ${body.to}`);
      // Signed out (or email not set up here): the traveller's own mail app takes over.
      if (res.status === 401 || res.status === 503) {
        open(mailtoUrl(subject, plainText(tripMessage(share(), site))));
        return flash("Opening your email app");
      }
      flash(body.reason ?? "The email couldn't be sent");
    } catch {
      flash("The email couldn't be sent");
    } finally {
      setSending(false);
    }
  };
  const menu = useRef<HTMLDetailsElement>(null);
  useCloseAway(menu);
  const pick = (go: () => void) => () => {
    if (menu.current) menu.current.open = false;
    go();
  };
  return (
    <details className="send-plan" ref={menu}>
      <summary className="export-btn" aria-label="Send the plan">
        {sending ? "Sending…" : "Send"} <span aria-hidden="true" className="send-caret">▾</span>
      </summary>
      <div className="send-menu" role="menu">
        <button type="button" role="menuitem" onClick={pick(() => open(whatsappUrl(tripMessage(share(), site))))}>
          WhatsApp
        </button>
        <button type="button" role="menuitem" onClick={pick(() => open(telegramUrl(site, tripMessage(share(), site))))}>
          Telegram
        </button>
        <button type="button" role="menuitem" disabled={sending} onClick={pick(() => void email())}>
          Email me
        </button>
      </div>
    </details>
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
              {p.offer && !p.offer.test && <span>{money(p.offer.total, p.offer.currency)} for your dates</span>}
              {p.offer?.test && <span>Bookable now from your wallet</span>}
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

const SLIP_GROUPS: { id: string; label: string; icon: string; kinds: TripAction["kind"][] }[] = [
  { id: "travel", label: "Getting there and back", icon: "✈", kinds: ["book_flight", "book_travel"] },
  { id: "ground", label: "Getting around", icon: "◍", kinds: ["book_rides"] },
  { id: "stay", label: "Where you'll stay", icon: "⌂", kinds: ["book_stay"] },
  { id: "tables", label: "Tables and tickets", icon: "✦", kinds: ["reserve_table", "enquire_venue"] },
  { id: "planned", label: "The rest of the planned spend", icon: "◎", kinds: ["planned"] },
];

export function ActionsCheckpoint({
  actions,
  demoLine = null,
  profile,
  busy,
  onConfirm,
  onLook,
}: {
  actions: TripAction[];
  /** "Take a look first": back to the trip to vet it before paying. */
  onLook?: () => void;
  /** Demo mode: the line calls actually ring. */
  demoLine?: string | null;
  profile: Profile;
  busy: boolean;
  onConfirm: (ids: string[], profile: Profile) => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => actions.filter((a) => a.recommended).map((a) => a.id));
  // Escape closes the slip, wherever it's scrolled to.
  const lookRef = useRef(onLook);
  lookRef.current = onLook;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && lookRef.current?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [me, setMe] = useState<Profile>({ name: profile.name, email: profile.email, phone: profile.phone });
  // Signed in: their account's name and email fill any gaps, so they never type what we already know.
  useEffect(() => {
    if (me.name?.trim() && me.email?.trim()) return;
    let live = true;
    fetch("/api/account", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { name?: string | null; email?: string | null }; profile?: Profile } | null) => {
        if (!live || !d) return;
        setMe((m) => ({
          ...m,
          name: m.name?.trim() || d.profile?.name || d.user?.name || m.name,
          email: m.email?.trim() || d.profile?.email || d.user?.email || m.email,
          phone: m.phone?.trim() || d.profile?.phone || m.phone,
        }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // Once, when the checkpoint opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const needsDetails = actions.some((a) => picked.includes(a.id) && a.mode === "auto");
  const demoCall = Boolean(demoLine) && actions.some((a) => picked.includes(a.id) && a.channel === "call" && a.mode === "auto");
  const phoneOk = /^\+?[\d\s().-]{8,20}$/.test(me.phone?.trim() ?? "");
  const missing = needsDetails && (!me.name?.trim() || !me.email?.trim() || (demoCall && !phoneOk));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const { w } = useWallet();
  const [look, setLook] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Everything the agent will pay for, in the person's own currency (prices are quoted in USD or the place's currency).
  // Every amount as US cents (the wallet's unit), at the day's rate.
  const local = (n: number, c: string) => {
    const per = c.toUpperCase() === "USD" ? 1 : w?.rates?.[c.toUpperCase()];
    return per ? Math.round((n / per) * 100) : null;
  };
  const paid = actions.filter((a) => picked.includes(a.id) && a.mode === "auto" && a.price && (a.channel === "reserve" || a.channel === "call"));
  const totalUsdCents = paid.reduce((n, a) => n + (local(a.price!.total, a.price!.currency) ?? 0), 0);
  const show = (a: TripAction) => {
    if (!a.price) return null;
    const cents = w ? local(a.price.total, a.price.currency) : null;
    return w && cents != null ? walletMoney(w)(cents) : money(a.price.total, a.price.currency);
  };
  const short = w && w.ready && totalUsdCents > w.balance;
  // The payment slip: every payment the trip needs, grouped the way a trip unfolds.
  const priced = actions.filter((a) => a.mode === "auto" && a.price && (a.channel === "reserve" || a.channel === "call"));
  // Homes, hostels and B&Bs to pick yourself (Airbnb, Vrbo, Booking.com), opened with the dates filled in.
  const homes = actions.filter((a) => a.kind === "book_stay" && a.channel === "link" && !a.placeId && a.url);
  const others = actions.filter((a) => !priced.includes(a) && !homes.includes(a));
  const homeLine = homes.length ? (
    <p className="ck-homes">
      <span>{(() => {
        // The area Qloo picked for their taste, carried in the link's title ("…homes in Trastevere on Airbnb").
        const area = homes[0].title.match(/ in (.+?) on /)?.[1];
        const what = homes.some((a) => /airbnb|vrbo/i.test(a.placeName ?? "")) ? "a whole home" : "your own";
        return area ? `Rather pick ${what} in ${area}, where your taste peaks?` : `Rather pick ${what}?`;
      })()}</span>
      {homes.map((a) => (
        <a key={a.id} href={a.url!} target="_blank" rel="noopener noreferrer" title={a.title}>
          {a.placeName} <span aria-hidden="true">↗</span>
        </a>
      ))}
    </p>
  ) : null;
  const groups = SLIP_GROUPS.map((g) => ({ ...g, items: priced.filter((a) => g.kinds.includes(a.kind)) })).filter((g) => g.items.length);
  const sub = (items: TripAction[]) => items.filter((a) => picked.includes(a.id)).reduce((n, a) => n + (local(a.price!.total, a.price!.currency) ?? 0), 0);
  const line = (a: TripAction) => {
    if (a.kind === "book_travel" || a.kind === "book_flight") return a.subject ?? "Paid from your wallet";
    if (a.kind === "book_rides") return `${a.rides?.length ?? 0} rides · ${a.subject ?? "estimated"}`;
    if (a.kind === "planned") return a.subject || "Set aside from your wallet";
    if (a.channel === "reserve") return "Booked and paid for every night";
    if (a.channel === "call") return demoLine ? "Paid, then a call to you to confirm (you play the place)" : `Paid, then a call to ${a.to ?? "the place"} to confirm`;
    return "";
  };
  const body = (
    <div className="ck-scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && !busy && onLook?.()}>
      <section className="lg checkpoint ck" role="dialog" aria-modal="true" aria-labelledby="cp-actions">
        <header className="ck-head">
          {/* Always in reach: the header stays put while the list scrolls. */}
          {onLook && (
            <button type="button" className="ck-x" autoFocus onClick={onLook} aria-label="Close the payment slip">
              ×
            </button>
          )}
          <p className="eyebrow">Your payment slip</p>
          <h2 id="cp-actions" className="cp-title">Approve the whole trip?</h2>
          <p className="muted">{priced.length ? `Everything the trip needs, paid in one tap from your Backline Wallet, with a receipt for each.` : "Here's everything I'll take care of."}</p>
        </header>
        <div className="ck-body">
          {w?.ready && priced.length > 0 && (
            <div className="ck-sum" aria-live="polite">
              <div><small>Total</small><b>{walletMoney(w)(totalUsdCents)}</b></div>
              <div><small>Wallet</small><span>{walletMoney(w)(w.balance)}</span></div>
              <div><small>After</small><span className={short ? "is-short" : ""}>{walletMoney(w)(w.balance - totalUsdCents)}</span></div>
            </div>
          )}
          {short && <p className="ck-warn">Your wallet is short for everything ticked. Untick something or add funds in your wallet.</p>}
          <div className="ck-slip">
            {groups.map((g) => (
              <section key={g.id} className="ck-group">
                <h3><span aria-hidden="true">{g.icon}</span>{g.label}{w ? <b>{walletMoney(w)(sub(g.items))}</b> : null}</h3>
                <ul>
                  {g.items.map((a) => {
                    const on = picked.includes(a.id);
                    return (
                      <li key={a.id}>
                        <button type="button" className={`ck-row${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(a.id)}>
                          <span className="ck-tick" aria-hidden="true" />
                          <span className="ck-txt"><b>{a.title}</b>{look && line(a) ? <small>{line(a)}</small> : null}</span>
                          <em>{show(a)}</em>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {g.id === "stay" && homeLine}
              </section>
            ))}
            {!groups.some((g) => g.id === "stay") && homeLine}
          </div>
          {others.length > 0 && (
            <details className="ck-also" open={!priced.length}>
              <summary>{priced.length ? "Also ready for you" : "Ready for you"} ({others.length})</summary>
              <ul>
                {others.map((a) => (
                  <li key={a.id}>
                    <button type="button" className={`ck-row${picked.includes(a.id) ? " on" : ""}`} aria-pressed={picked.includes(a.id)} onClick={() => toggle(a.id)}>
                      <span className="ck-tick" aria-hidden="true" />
                      <span className="ck-txt"><b>{a.title}</b><small>{a.channel === "email" ? (a.mode === "auto" ? `I'll email ${a.to}` : `Opens a ready email to ${a.to}`) : a.channel === "calendar" ? "Every stop, in your calendar" : a.channel === "link" ? "Opens with your dates filled in" : a.channel === "call" ? `Number and script for ${a.to}` : ""}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {priced.length > 0 && <button type="button" className="ck-toggle" onClick={() => setLook((v) => !v)} aria-expanded={look}>{look ? "Fewer details" : "Show details for each payment"}</button>}
          {needsDetails && (
            <div className="me">
              <p className="sub">Who I&rsquo;m booking for</p>
              <div className="me-row">
                <input aria-label="Your name" placeholder="Your name" value={me.name ?? ""} onChange={(e) => setMe({ ...me, name: e.target.value })} maxLength={80} autoComplete="name" />
                <input aria-label="Your email" placeholder="Email for replies" type="email" value={me.email ?? ""} onChange={(e) => setMe({ ...me, email: e.target.value })} maxLength={254} autoComplete="email" />
                <input aria-label="Your phone" placeholder={demoCall ? "Your phone, e.g. +234 811 000 0000" : "Phone (optional)"} type="tel" value={me.phone ?? ""} onChange={(e) => setMe({ ...me, phone: e.target.value })} maxLength={30} autoComplete="tel" required={demoCall} />
              </div>
              {demoCall && <p className="me-hint">This is a demo, so the confirmation calls ring <b>your</b> phone. Pick up and play the restaurant or hotel.</p>}
            </div>
          )}
        </div>
        <p className="ck-secure">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1.5 2.5 3.6v4c0 3.3 2.3 5.9 5.5 6.9 3.2-1 5.5-3.6 5.5-6.9v-4L8 1.5Zm-1 9.3L4.6 8.4l1-1L7 8.8l3.4-3.4 1 1L7 10.8Z" fill="currentColor"/></svg>
          <span>Nothing is charged until you approve. Payments are held and only taken once the booking is confirmed. <a href="/security" target="_blank" rel="noreferrer">How it's protected</a></span>
        </p>
        <footer className="cp-foot ck-foot">
          <button type="button" className="ck-look" onClick={() => (onLook ? onLook() : setLook((v) => !v))}>Take a look first</button>
          <button type="button" className="go" disabled={busy || picked.length === 0 || missing || Boolean(short)} onClick={() => onConfirm(picked, { ...profile, ...me })}>
            {busy ? "Paying…" : paid.length ? `Approve & pay${w?.ready ? ` ${walletMoney(w)(totalUsdCents)}` : ""}` : "Approve"}
          </button>
        </footer>
      </section>
    </div>
  );
  return mounted ? createPortal(body, document.body) : null;
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
  queued: "Next in line",
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
export function CallTracker({ id }: { id: string }) {
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
