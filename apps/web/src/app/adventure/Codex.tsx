"use client";
// The field guide: everything a traveller needs besides the places. Weather by day, money, public
// holidays, entry/safety/health/culture/connectivity notes, emergency numbers, phrases, local guides,
// and what Qloo's taste means for the trip. Every line says where it came from, or that it's unverified.
import { useState } from "react";
import type { TripIntelOutput, TripTravelOutput } from "@backline/engine";
import { SECTION_TITLES } from "@backline/engine";

const ICON: Record<string, string> = { entry: "🛂", safety: "🛡", health: "✚", culture: "❖", connect: "⌁", transport: "⇄", food: "◒" };
const WX: Record<string, string> = { Clear: "☀", "Mostly clear": "🌤", Cloudy: "☁", Fog: "🌫", Drizzle: "🌦", Rain: "🌧", Showers: "🌦", Thunderstorm: "⛈", Snow: "❄" };
const wxIcon = (label: string) => WX[label] ?? Object.entries(WX).find(([k]) => label.toLowerCase().includes(k.toLowerCase()))?.[1] ?? "•";
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const TABS = [
  { id: "go", label: "Getting there" },
  { id: "now", label: "Weather & money" },
  { id: "rules", label: "Rules & safety" },
  { id: "people", label: "Guides & phrases" },
  { id: "taste", label: "Your taste" },
] as const;

export default function Codex({ intel, travel = null, pending, className = "" }: { intel: TripIntelOutput | null; travel?: TripTravelOutput | null; pending: boolean; className?: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>(travel?.options.length ? "go" : "now");
  if (!intel) {
    return (
      <section className={`codex ${className}`} aria-label="Field guide">
        <header className="codex-head">
          <h3>Field guide</h3>
          <span className="codex-sub">{pending ? "Scouting weather, rules, safety, guides…" : "Not available for this trip"}</span>
        </header>
        {pending && <div className="codex-skel" aria-hidden="true"><i /><i /><i /></div>}
      </section>
    );
  }
  const w = intel.weather;
  const m = intel.money;
  const secs = intel.sections.filter((s) => s.items.length > 0);
  return (
    <section className={`codex ${className}`} aria-label="Field guide">
      <header className="codex-head">
        <h3>Field guide · {intel.place.city}</h3>
        <span className="codex-sub">
          {intel.place.country ? `${intel.place.country} · ` : ""}
          {intel.time.zone ?? ""}
          {intel.time.utcOffsetHours != null ? ` (UTC${intel.time.utcOffsetHours >= 0 ? "+" : ""}${intel.time.utcOffsetHours})` : ""}
        </span>
      </header>
      <div className="codex-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "go" && (
        <div className="codex-pane">
          <h4>{travel?.origin && travel.destination ? `${travel.origin} → ${travel.destination}` : "Getting there"}{travel?.km ? ` · ${travel.km.toLocaleString("en")} km` : ""}</h4>
          {travel && travel.options.length > 0 ? (
            <ul className="plain">
              {travel.options.map((o, i) => (
                <li key={i}>
                  <b>{o.title}</b>{o.best ? " · best pick" : ""}{o.duration ? ` · ${o.duration}` : ""}
                  {o.priceMin != null ? ` · ${o.currency ?? ""} ${o.priceMin.toLocaleString("en")}${o.priceMax && o.priceMax > o.priceMin ? `–${o.priceMax.toLocaleString("en")}` : ""} per person` : " · price not published"}
                  {o.note ? ` — ${o.note}` : ""}{" "}
                  {o.url ? <a href={o.url} target="_blank" rel="noreferrer noopener">{o.site ?? "source"}</a> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="codex-none">No reliable fares found for this route. Check an airline or rail site for today's price.</p>
          )}
        </div>
      )}

      {tab === "now" && (
        <div className="codex-pane">
          <h4>{w.basis === "forecast" ? "Forecast" : w.basis === "history" ? "What it's usually like (3-year average for these dates)" : "Weather"}</h4>
          {w.days.length > 0 ? (
            <ul className="wx-row">
              {w.days.map((d) => (
                <li key={d.date}>
                  <b>{day(d.date)}</b>
                  <span className="wx-ic" aria-hidden="true">{wxIcon(d.label)}</span>
                  <span>{d.label}</span>
                  <span className="wx-t">{d.tmax != null ? Math.round(d.tmax) : "–"}° / {d.tmin != null ? Math.round(d.tmin) : "–"}°</span>
                  <span className="wx-r">{d.rainChance != null ? `${Math.round(d.rainChance)}% rain` : d.rainMm != null ? `${d.rainMm.toFixed(1)} mm` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="codex-none">No weather data for these dates.</p>
          )}
          {w.summary && <p className="codex-note">{w.summary}</p>}
          {w.packing.length > 0 && (
            <>
              <h4>Pack</h4>
              <ul className="chips">{w.packing.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
          {m.local && (
            <>
              <h4>Money</h4>
              {m.rate && m.home ? (
                <p className="codex-note">
                  1 {m.home} ≈ {m.rate.toLocaleString("en", { maximumFractionDigits: 2 })} {m.local}
                  {m.asOf ? ` · rate from ${m.asOf}` : " · illustrative rate"}
                </p>
              ) : (
                <p className="codex-note">Local currency: {m.local}</p>
              )}
              {m.examples.length > 0 && m.home && (
                <ul className="chips">{m.examples.map((e) => <li key={e.home}>{e.home} {m.home} = {Math.round(e.local).toLocaleString("en")} {m.local}</li>)}</ul>
              )}
            </>
          )}
          {intel.holidays.length > 0 && (
            <>
              <h4>Public holidays on your dates</h4>
              <ul className="plain">{intel.holidays.map((h) => <li key={h.date + h.name}><b>{day(h.date)}</b> {h.name}{h.local && h.local !== h.name ? ` (${h.local})` : ""}</li>)}</ul>
            </>
          )}
        </div>
      )}

      {tab === "rules" && (
        <div className="codex-pane">
          {intel.emergency && (
            <div className="sos">
              <b>Emergency</b>
              {([["Police", intel.emergency.police], ["Ambulance", intel.emergency.ambulance], ["Fire", intel.emergency.fire], ["General", intel.emergency.general]] as const).filter(([, v]) => v).map(([k, v]) => <span key={k}>{k} <em>{v}</em></span>)}
              {!intel.emergency.verified && <small>Double-check before you rely on it.</small>}
            </div>
          )}
          {secs.map((s) => (
            <div key={s.id} className="codex-sec">
              <h4><span aria-hidden="true">{ICON[s.id] ?? "•"}</span> {SECTION_TITLES[s.id] ?? s.title}</h4>
              <ul className="plain">
                {s.items.map((it, i) => (
                  <li key={i}>
                    {it.text}{" "}
                    {it.url ? <a href={it.url} target="_blank" rel="noreferrer noopener">{it.site ?? "source"}</a> : <span className="unv">unverified, check before you go</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {secs.length === 0 && <p className="codex-none">I couldn't find sourced notes for this destination.</p>}
        </div>
      )}

      {tab === "people" && (
        <div className="codex-pane">
          <h4>Local guides and tours</h4>
          {intel.guides.length ? (
            <ul className="guides">
              {intel.guides.map((g) => (
                <li key={g.url + g.name}>
                  <a href={g.url} target="_blank" rel="noreferrer noopener"><b>{g.name}</b></a>
                  <span className="kind">{g.kind}</span>
                  <p>{g.why}</p>
                  <small>{g.site}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="codex-none">No guides found yet.</p>
          )}
          {intel.phrases.length > 0 && (
            <>
              <h4>Say it like a local</h4>
              <ul className="phr">{intel.phrases.map((p) => <li key={p.say}><b>{p.say}</b><span>{p.means}</span></li>)}</ul>
            </>
          )}
        </div>
      )}

      {tab === "taste" && (
        <div className="codex-pane">
          <h4>Because of your taste</h4>
          {intel.tasteTips.length ? (
            <ul className="tips">{intel.tasteTips.map((t, i) => <li key={i}><em>{t.because}</em>{t.tip}</li>)}</ul>
          ) : (
            <p className="codex-none">Add a few things you love and Qloo will tune these.</p>
          )}
        </div>
      )}

      {intel.gaps.length > 0 && <p className="codex-gaps">Couldn't find: {intel.gaps.join(" · ")}</p>}
    </section>
  );
}
