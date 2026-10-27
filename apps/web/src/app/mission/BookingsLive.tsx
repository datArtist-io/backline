"use client";
// The trip being booked, live, inside the expedition: every call ringing and talking, every payment
// going through, every confirmation number arriving. Test-mode payments are labelled as such.
import { useEffect, useState } from "react";
import type { TripActionsOutput, TripExecuteOutput } from "@backline/engine";
import MiniBrowser from "./MiniBrowser";

type Action = TripActionsOutput["actions"][number];
type Result = TripExecuteOutput["results"][number];

const DONE = new Set(["sent", "booked", "held", "calling"]);

const LABEL: Record<Result["status"], string> = {
  booked: "Booked",
  held: "Held for you",
  sent: "Sent",
  calling: "On the phone",
  ready: "Your turn",
  needs_info: "Needs your details",
  failed: "Didn't go through",
  skipped: "Skipped",
};

function ChannelIcon({ channel, status }: { channel: Action["channel"]; status: Result["status"] }) {
  const common = { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (status === "booked")
    return (
      <svg {...common} className="bk-ico bk-check">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  if (channel === "call")
    return (
      <svg {...common} className="bk-ico bk-phone">
        <path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
      </svg>
    );
  if (channel === "email")
    return (
      <svg {...common} className="bk-ico">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  if (channel === "reserve")
    return (
      <svg {...common} className="bk-ico bk-card">
        <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" />
        <path d="M2.5 10h19M6 15h4" />
      </svg>
    );
  if (channel === "calendar")
    return (
      <svg {...common} className="bk-ico">
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
    );
  return (
    <svg {...common} className="bk-ico">
      <path d="M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

/** Where else a place can be reached, for when one way fails. */
export type Reach = { name: string; website: string | null; email: string | null; phone: string | null };
type CallState = { id: string; status: string; ended: boolean; outcome: string; retryable: boolean; summary: string | null; transcript: string | null; endedReason: string | null };

const OUTCOME_TEXT: Record<string, string> = {
  live: "On the call now",
  talked: "Call finished",
  no_answer: "No one picked up",
  busy: "The line was busy",
  voicemail: "Went to voicemail; I asked them to call you back",
  no_audio: "The call connected but no sound came through from their side",
  failed: "The call couldn't go through",
};

/** Follows one AI call: live status, transcript, one automatic retry, then other ways to book. */
function LiveCall({ id: first, reach, onWebsite, onDone }: { id: string; reach: Reach | null; onWebsite: (url: string) => void; onDone: (ok: boolean) => void }) {
  const [id, setId] = useState(first);
  const [s, setS] = useState<CallState | null>(null);
  const [tries, setTries] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let n = 0;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/calls/${encodeURIComponent(id)}`, { cache: "no-store" });
        const d = (await res.json()) as CallState & { error?: string };
        if (!res.ok) throw new Error(d.error);
        if (stop) return;
        setS(d);
        if (d.ended) return;
      } catch {
        /* keep trying */
      }
      if (++n < 150) setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [id]);
  const ended = Boolean(s?.ended);
  const ok = ended && (s?.outcome === "talked" || s?.outcome === "voicemail");
  const failed = ended && !ok;
  useEffect(() => {
    if (!ended) return;
    if (failed && s?.retryable && tries < 2) {
      // One more try straight away: a dropped line is often a one-off.
      setNote("Trying the call once more…");
      fetch(`/api/calls/${encodeURIComponent(id)}`, { method: "POST" })
        .then((r) => r.json())
        .then((d: { id?: string; error?: string }) => {
          if (d.id) {
            setTries((t) => t + 1);
            setS(null);
            setId(d.id);
            setNote(null);
          } else {
            setTries(2);
            setNote(d.error ?? "Couldn't place it again.");
            onDone(false);
          }
        })
        .catch(() => {
          setTries(2);
          onDone(false);
        });
      return;
    }
    onDone(ok);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, id]);
  const label = !s ? "Connecting…" : s.ended ? (OUTCOME_TEXT[s.outcome] ?? "Call finished") : s.status === "in-progress" ? "On the call now" : s.status === "ringing" ? "Ringing" : "Placing the call";
  return (
    <div className={`bk-callbox${failed ? " is-failed" : ok ? " is-ok" : ""}`}>
      <p className="bk-callline">
        <span className={`bk-calldot${ended ? (ok ? " ok" : " bad") : ""}`} aria-hidden="true" />
        <b>{label}</b>
        {tries > 1 && <em>try {tries} of 2</em>}
      </p>
      {note && <p className="bk-callnote">{note}</p>}
      {s?.summary && <p className="bk-callsum">{s.summary}</p>}
      {s?.transcript && (
        <details className="bk-transcript">
          <summary>Transcript</summary>
          <pre>{s.transcript}</pre>
        </details>
      )}
      {failed && tries >= 2 && (
        <div className="bk-fallback">
          <p>The call didn&rsquo;t work, so here are other ways to book{reach ? ` ${reach.name}` : ""}. Everything else carries on.</p>
          <div className="bk-fallback-acts">
            {reach?.website && <button type="button" className="bk-fb primary" onClick={() => onWebsite(reach.website!)}>Book on their website</button>}
            {reach?.email && <a className="bk-fb" href={`mailto:${reach.email}`}>Email them</a>}
            {reach?.phone && <a className="bk-fb" href={`tel:${reach.phone}`}>Call them yourself</a>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BookingsLive({ actions, execute, running, places = {} }: { actions: TripActionsOutput; execute: TripExecuteOutput | null; running: boolean; places?: Record<string, Reach> }) {
  const byId = new Map(actions.actions.map((a) => [a.id, a]));
  const results = execute?.results ?? [];
  const [browse, setBrowse] = useState<{ url: string; title: string } | null>(null);
  const [calls, setCalls] = useState<Record<string, boolean>>({});
  // A call only counts as done once it has actually connected and finished.
  const done = results.filter((r) => (r.status === "calling" ? calls[r.actionId] === true : DONE.has(r.status))).length;
  const total = Math.max(1, results.length);
  const failedCalls = Object.values(calls).filter((x) => x === false).length;
  const test = results.some((r) => /test (booking|mode)|no real money/i.test(r.message));
  return (
    <section className="bk" aria-live="polite">
      <header className="bk-head">
        <div className="bk-ring" style={{ ["--p" as string]: `${(done / total) * 100}%` }} aria-hidden="true">
          <span>{done}</span>
        </div>
        <div>
          <h2>{!execute ? "Booking your trip" : done === results.length ? "Your trip is booked" : "Booking your trip"}</h2>
          <p>{!execute ? (running ? "Calling, paying and confirming now…" : "Waiting for your go-ahead") : `${done} of ${results.length} done${failedCalls ? ` · ${failedCalls} need${failedCalls === 1 ? "s" : ""} another way` : ""}${test ? " · payments in test mode, no real money moves" : ""}`}</p>
        </div>
      </header>
      {!execute && running && (
        <ol className="bk-list">
          {actions.actions.slice(0, 6).map((a, i) => (
            <li key={a.id} className="bk-row is-pending" style={{ ["--i" as string]: i }}>
              <span className="bk-badge"><ChannelIcon channel={a.channel} status="ready" /></span>
              <div className="bk-body">
                <b>{a.title}</b>
                <span className="bk-shimmer" />
              </div>
            </li>
          ))}
        </ol>
      )}
      {execute && (
        <ol className="bk-list">
          {results.map((r, i) => {
            const a = byId.get(r.actionId);
            if (!a) return null;
            const testPay = /test (booking|mode)|no real money/i.test(r.message);
            return (
              <li key={r.actionId} className={`bk-row is-${r.status}`} style={{ ["--i" as string]: i }}>
                <span className="bk-badge"><ChannelIcon channel={a.channel} status={r.status} /></span>
                <div className="bk-body">
                  <div className="bk-top">
                    <b>{a.title}</b>
                    <em className={`bk-chip s-${r.status === "calling" && calls[r.actionId] === false ? "failed" : r.status === "calling" && calls[r.actionId] ? "sent" : r.status}`}>
                      {r.status === "calling" && calls[r.actionId] === false ? "Needs another way" : r.status === "calling" && calls[r.actionId] ? "Called" : LABEL[r.status]}
                    </em>
                  </div>
                  <p>{r.message}</p>
                  {r.status === "booked" && r.ref && (
                    <div className="bk-receipt">
                      <div>
                        <small>Confirmation</small>
                        <code>{r.ref}</code>
                      </div>
                      {a.price && (
                        <div>
                          <small>{testPay ? "Test payment" : "Paid"}</small>
                          <strong>{Math.round(a.price.total).toLocaleString("en")} {a.price.currency}</strong>
                        </div>
                      )}
                      {testPay && <span className="bk-test">Test mode · no money moved</span>}
                    </div>
                  )}
                  {r.status === "calling" && r.ref && (
                    <LiveCall
                      id={r.ref}
                      reach={a.placeId ? (places[a.placeId] ?? null) : null}
                      onWebsite={(url) => setBrowse({ url, title: a.placeName ?? "Their website" })}
                      onDone={(ok) => setCalls((c) => ({ ...c, [r.actionId]: ok }))}
                    />
                  )}
                  {r.status === "failed" && a.placeId && places[a.placeId] && (places[a.placeId].website || places[a.placeId].email) && (
                    <div className="bk-fallback">
                      <p>That didn&rsquo;t go through, so here&rsquo;s another way. Everything else carries on.</p>
                      <div className="bk-fallback-acts">
                        {places[a.placeId].website && <button type="button" className="bk-fb primary" onClick={() => setBrowse({ url: places[a.placeId!].website!, title: a.placeName ?? "Their website" })}>Book on their website</button>}
                        {places[a.placeId].email && <a className="bk-fb" href={`mailto:${places[a.placeId].email}`}>Email them</a>}
                      </div>
                    </div>
                  )}
                  {r.checkoutUrl && (
                    <a className="eq-btn gold" href={r.checkoutUrl} target="_blank" rel="noopener noreferrer"><span>Pay securely to confirm</span></a>
                  )}
                  {r.status === "ready" && a.url && a.channel === "link" && (
                    <button type="button" className="bk-fb primary" onClick={() => setBrowse({ url: a.url!, title: a.placeName ?? a.title })}>Book in the mini browser</button>
                  )}
                  {r.status === "ready" && a.url && a.channel !== "link" && (
                    <a className="eq-btn" href={a.url} target="_blank" rel="noopener noreferrer"><span>Open</span></a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {browse && <MiniBrowser url={browse.url} title={browse.title} onClose={() => setBrowse(null)} />}
    </section>
  );
}
