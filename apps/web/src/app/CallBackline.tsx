"use client";
// "Call Backline": a real phone number. Say where you're going and what you love, and the trip
// appears here while you talk, under a 4-digit code the agent reads out. No caller details shown.
import { useEffect, useMemo, useState } from "react";

type Item = { code: string; at: string; live: boolean; destination: string | null; days: number | null; travellers: number | null; loves: string | null; url: string | null };

const pretty = (n: string) => {
  const d = n.replace(/[^\d+]/g, "");
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(d);
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : d.replace(/^(\+\d{1,3})(\d{3})(\d{3})(\d+)$/, "$1 $2 $3 $4");
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export default function CallBackline() {
  const [number, setNumber] = useState<string | null>(null);
  const [trips, setTrips] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      const d = await fetch("/api/call-trips", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (stop) return;
      if (d) {
        setNumber(d.number ?? null);
        setTrips(Array.isArray(d.trips) ? d.trips : []);
      }
      setLoaded(true);
      // Faster while someone is on the line, slower otherwise; paused while the tab is hidden.
      const live = Array.isArray(d?.trips) && d.trips.some((t: Item) => t.live);
      timer = window.setTimeout(tick, document.hidden ? 20000 : live ? 3000 : 8000);
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, []);

  const shown = useMemo(() => {
    const c = code.replace(/\D/g, "");
    return c ? trips.filter((t) => t.code.startsWith(c)) : trips;
  }, [trips, code]);

  if (loaded && !number && !trips.length) return null;
  return (
    <section className="callin" aria-labelledby="callin-h">
      <div className="callin-card lg">
        <div className="callin-copy">
          <p className="eyebrow">Call Backline</p>
          <h2 id="callin-h">Plan a trip with one phone call</h2>
          <p>Ring Backline&rsquo;s AI agent. Say where you&rsquo;re going and what you love. It asks a couple of questions, then your trip starts building right here, under the code it reads out. Want the link? It can email it to you.</p>
          {number ? (
            <a className="callin-num" href={`tel:${number.replace(/[^\d+]/g, "")}`}>
              <span className="callin-dot" aria-hidden="true" />
              {pretty(number)}
            </a>
          ) : (
            <span className="callin-num is-wait">Connecting the line…</span>
          )}
          <p className="callin-try">Try: &ldquo;4 days in Lisbon for two, we love fado and seafood.&rdquo;</p>
        </div>
        <div className="callin-board">
          <div className="callin-board-head">
            <b>Trips planned by phone</b>
            <input inputMode="numeric" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value.slice(0, 4))} aria-label="Find your trip by its 4-digit code" maxLength={4} />
          </div>
          {shown.length ? (
            <ul>
              {shown.map((t) => (
                <li key={t.code} className={t.live ? "is-live" : ""}>
                  <span className="callin-code" aria-label={`Code ${t.code}`}>{t.code}</span>
                  <div className="callin-trip">
                    <b>{t.destination ?? "On the phone now…"}</b>
                    <span>
                      {t.destination ? [t.days ? `${t.days} days` : null, t.travellers ? `${t.travellers} ${t.travellers === 1 ? "person" : "people"}` : null, t.loves].filter(Boolean).join(" · ") : "Listening to the caller"}
                    </span>
                  </div>
                  <span className="callin-when">{t.live && !t.destination ? <i className="callin-pulse" aria-hidden="true" /> : ago(t.at)}</span>
                  {t.url && <a className="callin-open" href={t.url.replace(/^https?:\/\/[^/]+/, "")}>Open</a>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="callin-empty">{code ? "No trip with that code yet. It appears the moment the agent plans it." : "No calls yet today. Be the first: your trip shows up here as you talk."}</p>
          )}
        </div>
      </div>
    </section>
  );
}
