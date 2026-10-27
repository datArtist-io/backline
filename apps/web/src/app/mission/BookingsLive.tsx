"use client";
// The trip being booked, live, inside the expedition: every call ringing and talking, every payment
// going through, every confirmation number arriving. Test-mode payments are labelled as such.
import { useEffect, useState } from "react";
import type { TripActionsOutput, TripExecuteOutput } from "@backline/engine";
import MiniBrowser from "./MiniBrowser";
import { loadProfile } from "@/lib/profile";

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

/** Where else a place can be reached, and how well it fits (Qloo affinity), for rerouting. */
export type Reach = { name: string; website: string | null; email: string | null; phone: string | null; kind: string; affinity: number | null };
type CallState = { id: string; status: string; ended: boolean; outcome: string; retryable: boolean; summary: string | null; transcript: string | null; endedReason: string | null };
type Leg = { placeId: string | null; name: string; id: string | null; state: CallState | null; note: string | null };

/** Short, calm words for how a call ended. Never an error code. */
const LEG_TEXT: Record<string, string> = {
  live: "On the call",
  talked: "Booked by phone",
  no_answer: "No answer",
  busy: "Line busy",
  voicemail: "Left a message",
  no_audio: "Line dropped",
  failed: "Couldn't connect",
};

const poll = async (id: string): Promise<CallState | null> => {
  try {
    const res = await fetch(`/api/calls/${encodeURIComponent(id)}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as CallState) : null;
  } catch {
    return null;
  }
};

/**
 * Follows a booking call. If a place doesn't connect, it moves straight on to Qloo's next best place
 * of the same kind and calls that one, and so on; only when none connect does it offer the website.
 */
function LiveCall({
  id: first,
  action,
  alternates,
  phone,
  client,
  reachOf,
  onWebsite,
  onDone,
}: {
  id: string;
  action: Action;
  reachOf: (id: string | null) => Reach | null;
  alternates: (Reach & { id: string })[];
  phone: string | null;
  client: string | null;
  onWebsite: (url: string, title: string) => void;
  onDone: (ok: boolean) => void;
}) {
  const [legs, setLegs] = useState<Leg[]>([{ placeId: action.placeId, name: action.placeName ?? "the place", id: first, state: null, note: null }]);
  const [open, setOpen] = useState(false);
  const cur = legs[legs.length - 1];
  const finished = legs.some((l) => l.state?.outcome === "talked" || l.state?.outcome === "voicemail") || (cur.state?.ended && legs.length > alternates.length) || cur.note === "end";

  // Follow the current call every 3 seconds until it ends.
  useEffect(() => {
    if (!cur.id) return;
    let stop = false;
    let n = 0;
    const tick = async () => {
      const st = await poll(cur.id!);
      if (stop) return;
      if (st) setLegs((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, state: st } : l)));
      if (st?.ended) return;
      if (++n < 150) setTimeout(tick, 3000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [cur.id]);

  // When a call ends without getting through, call the next best place.
  useEffect(() => {
    const st = cur.state;
    if (!st?.ended) return;
    const ok = st.outcome === "talked" || st.outcome === "voicemail";
    if (ok) {
      onDone(true);
      return;
    }
    const next = alternates[legs.length - 1];
    if (!next) {
      onDone(false);
      return;
    }
    const rename = (t: string | null) => (t ?? "").split(action.placeName ?? "\u0000").join(next.name);
    setLegs((ls) => [...ls, { placeId: next.id, name: next.name, id: null, state: null, note: null }]);
    fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeName: next.name, opening: rename(action.callOpening), brief: rename(action.callBrief), to: next.phone, phone, client }),
    })
      .then((r) => r.json())
      .then((d: { id?: string; error?: string }) =>
        setLegs((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, id: d.id ?? null, note: d.id ? null : "end" } : l)))
      )
      .catch(() => setLegs((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, note: "end" } : l))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.state?.ended]);

  const talked = legs.find((l) => l.state?.outcome === "talked" || l.state?.outcome === "voicemail");
  const live = !finished && cur.id && !cur.state?.ended;
  const lastWithSite = [...legs].reverse().map((l) => reachOf(l.placeId)).find((r) => r?.website);
  const site = lastWithSite?.website ?? null;
  return (
    <div className={`bk-callbox${talked ? " is-ok" : finished ? " is-done" : ""}`}>
      <ol className="bk-legs">
        {legs.map((l, i) => {
          const st = l.state;
          const label = !l.id && l.note !== "end" ? "Dialling…" : l.note === "end" ? "Skipped" : !st ? "Connecting…" : st.ended ? (LEG_TEXT[st.outcome] ?? "Finished") : st.status === "in-progress" ? "On the call" : st.status === "ringing" ? "Ringing" : "Dialling…";
          const state = st?.ended ? (st.outcome === "talked" || st.outcome === "voicemail" ? "ok" : "moved") : "live";
          return (
            <li key={i} className={`bk-leg is-${state}`} style={{ ["--i" as string]: i }}>
              <span className="bk-leg-dot" aria-hidden="true" />
              <b>{l.name}</b>
              <em>{label}</em>
            </li>
          );
        })}
      </ol>
      {live && legs.length > 1 && <p className="bk-callnote">{legs[legs.length - 2].name} couldn&rsquo;t take the call, so I&rsquo;m trying {cur.name}, Qloo&rsquo;s next best.</p>}
      {talked?.state?.summary && <p className="bk-callsum">{talked.state.summary}</p>}
      {legs.some((l) => l.state?.transcript) && (
        <details className="bk-transcript" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Transcript</summary>
          <pre>{(talked ?? cur).state?.transcript ?? ""}</pre>
        </details>
      )}
      {finished && !talked && (
        <div className="bk-fallback">
          <p>No one could take the call right now, so let&rsquo;s book it online instead.</p>
          <div className="bk-fallback-acts">
            {site && <button type="button" className="bk-fb primary" onClick={() => onWebsite(site, lastWithSite!.name)}>Book on {lastWithSite!.name}&rsquo;s website</button>}
            {!site && action.placeName && <a className="bk-fb primary" href={`https://www.google.com/search?q=${encodeURIComponent(`${action.placeName} reservation`)}`} target="_blank" rel="noopener noreferrer">Find a booking page</a>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BookingsLive({
  actions,
  execute,
  running,
  places = {},
  onCalendar,
}: {
  actions: TripActionsOutput;
  execute: TripExecuteOutput | null;
  running: boolean;
  places?: Record<string, Reach>;
  onCalendar?: () => void;
}) {
  const me = typeof window !== "undefined" ? loadProfile() : {};
  const used = new Set(actions.actions.map((a) => a.placeId).filter(Boolean));
  const alternatesFor = (placeId: string | null) => {
    const kind = placeId ? places[placeId]?.kind : null;
    return Object.entries(places)
      .filter(([id, p]) => kind && p.kind === kind && id !== placeId && !used.has(id))
      .sort((a, b) => (b[1].affinity ?? 0) - (a[1].affinity ?? 0))
      .slice(0, 3)
      .map(([id, p]) => ({ ...p, id }));
  };
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
                      action={a}
                      alternates={alternatesFor(a.placeId)}
                      phone={me.phone ?? null}
                      client={me.name ?? null}
                      reachOf={(id) => (id ? (places[id] ?? null) : null)}
                      onWebsite={(url, title) => setBrowse({ url, title })}
                      onDone={(ok) => setCalls((c) => ({ ...c, [r.actionId]: ok }))}
                    />
                  )}
                  {a.channel === "calendar" && onCalendar && (
                    <button type="button" className="bk-fb primary" onClick={onCalendar}>Add to calendar</button>
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
