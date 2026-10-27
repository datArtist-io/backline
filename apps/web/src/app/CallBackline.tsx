"use client";
// The live voice demo, in one tidy card: talk to Backline here in the browser, call its number, or
// have it call you. Trips planned by voice show underneath, once there are any (code and trip only).
import { useEffect, useRef, useState } from "react";
import TalkInBrowser, { VAPI_KEY } from "./TalkInBrowser";
import CallMeDemo from "./CallMeDemo";

type Item = { code: string; at: string; live: boolean; destination: string | null; days: number | null; travellers: number | null; loves: string | null; url: string | null };
type Tab = "talk" | "call" | "callme";

const KEY = Boolean(VAPI_KEY);

const pretty = (n: string) => {
  const d = n.replace(/[^\d+]/g, "");
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(d);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : d;
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export default function CallBackline() {
  const [tab, setTab] = useState<Tab>(KEY ? "talk" : "call");
  const [number, setNumber] = useState<string | null>(null);
  const [trips, setTrips] = useState<Item[]>([]);
  const tripsRef = useRef<Item[]>([]);
  tripsRef.current = trips;

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      if (!document.hidden) {
        const d = await fetch("/api/call-trips", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        if (stop) return;
        if (d) {
          setNumber(d.number ?? null);
          setTrips(Array.isArray(d.trips) ? d.trips : []);
        }
      }
      const live = tripsRef.current.some((t) => t.live);
      timer = window.setTimeout(tick, live ? 4000 : 10000);
    };
    // After the hero has settled: nothing here should compete with the first paint.
    timer = window.setTimeout(tick, 1200);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { id: Tab; label: string }[] = [...(KEY ? [{ id: "talk" as Tab, label: "Talk here" }] : []), { id: "call", label: "Call it" }, { id: "callme", label: "It calls you" }];

  return (
    <section className="voice" aria-labelledby="voice-h">
      <div className="voice-card lg">
        <div className="voice-copy">
          <p className="eyebrow">Live voice agent</p>
          <h2 id="voice-h">Talk to Backline</h2>
          <p>Plan a trip out loud. It&rsquo;s the real agent: it listens, reads your taste with Qloo and makes real phone calls.</p>
        </div>
        <div className="voice-side">
          <div className="voice-tabs" role="tablist" aria-label="How to talk to Backline">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="voice-panel" role="tabpanel">
            {tab === "talk" && (
              <>
                <TalkInBrowser />
                <p className="voice-hint">Try &ldquo;4 days in Lisbon for two, we love fado.&rdquo; Your trip opens when you&rsquo;re done.</p>
              </>
            )}
            {tab === "call" && (
              <>
                {number ? (
                  <a className="callin-num" href={`tel:${number.replace(/[^\d+]/g, "")}`}>
                    <span className="callin-dot" aria-hidden="true" />
                    {pretty(number)}
                  </a>
                ) : (
                  <span className="callin-num is-wait">Connecting the line…</span>
                )}
                <p className="voice-hint">Say where you&rsquo;re going and what you love. Your trip appears below under the code it reads out.</p>
              </>
            )}
            {tab === "callme" && (
              <>
                <CallMeDemo />
                <p className="voice-hint">Play a restaurant and listen to it book a table.</p>
              </>
            )}
          </div>
        </div>
        {trips.length > 0 && (
          <div className="voice-trips">
            <b>Planned by voice</b>
            <ul>
              {trips.slice(0, 3).map((t) => (
                <li key={t.code} className={t.live ? "is-live" : ""}>
                  <span className="callin-code" aria-label={`Code ${t.code}`}>{t.code}</span>
                  <span className="voice-trip">
                    <b>{t.destination ?? "On the line now…"}</b>
                    {t.destination ? [t.days ? `${t.days} days` : null, t.loves].filter(Boolean).join(" · ") : null}
                  </span>
                  {t.url ? <a className="callin-open" href={t.url.replace(/^https?:\/\/[^/]+/, "")}>Open</a> : <span className="callin-when">{t.live ? <i className="callin-pulse" aria-hidden="true" /> : ago(t.at)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
