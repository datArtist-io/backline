"use client";
// The trip being booked, live, inside the expedition: every call ringing and talking, every payment
// going through, every confirmation number arriving. Test-mode payments are labelled as such.
import type { TripActionsOutput, TripExecuteOutput } from "@backline/engine";
import { CallTracker } from "./trip";

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

export default function BookingsLive({ actions, execute, running }: { actions: TripActionsOutput; execute: TripExecuteOutput | null; running: boolean }) {
  const byId = new Map(actions.actions.map((a) => [a.id, a]));
  const results = execute?.results ?? [];
  const done = results.filter((r) => DONE.has(r.status)).length;
  const total = Math.max(1, results.length);
  const test = results.some((r) => /test (booking|mode)|no real money/i.test(r.message));
  return (
    <section className="bk" aria-live="polite">
      <header className="bk-head">
        <div className="bk-ring" style={{ ["--p" as string]: `${(done / total) * 100}%` }} aria-hidden="true">
          <span>{done}</span>
        </div>
        <div>
          <h2>{!execute ? "Booking your trip" : done === results.length ? "Your trip is booked" : "Booking your trip"}</h2>
          <p>{!execute ? (running ? "Calling, paying and confirming now…" : "Waiting for your go-ahead") : `${done} of ${results.length} done${test ? " · payments in test mode, no real money moves" : ""}`}</p>
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
                    <em className={`bk-chip s-${r.status}`}>{LABEL[r.status]}</em>
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
                  {r.status === "calling" && r.ref && <div className="bk-call"><CallTracker id={r.ref} /></div>}
                  {r.checkoutUrl && (
                    <a className="eq-btn gold" href={r.checkoutUrl} target="_blank" rel="noopener noreferrer"><span>Pay securely to confirm</span></a>
                  )}
                  {r.status === "ready" && a.url && (
                    <a className="eq-btn" href={a.url} target="_blank" rel="noopener noreferrer"><span>Open</span></a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
