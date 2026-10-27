"use client";
// A small browser for bookings that only happen on a website. The site is checked first (live, not
// parked, not an error); if it allows being shown inside Backline it opens right here, otherwise in a
// compact window of its own. Either way the person stays in the trip.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Check = { ok: boolean; unconfirmed?: boolean; status?: number; finalUrl?: string; title?: string | null; ms?: number; embeddable?: boolean; reason?: string | null };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export function openWindow(url: string) {
  const w = Math.min(520, window.screen.availWidth - 40);
  const h = Math.min(860, window.screen.availHeight - 60);
  const left = Math.max(0, window.screenX + window.outerWidth - w - 40);
  const top = Math.max(0, window.screenY + 60);
  const win = window.open(url, "backline-book", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!win) window.open(url, "_blank", "noopener,noreferrer");
}

export default function MiniBrowser({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/site-check?url=${encodeURIComponent(url)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Check) => live && setCheck(d))
      .catch(() => live && setCheck({ ok: false, reason: "Couldn't check the site just now." }));
    return () => {
      live = false;
    };
  }, [url]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const target = check?.finalUrl ?? url;
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => setRoot((document.querySelector(".eq") as HTMLElement | null) ?? document.body), []);
  if (!root) return null;
  return createPortal(
    <div className="mb" role="dialog" aria-label={`Book on ${host(target)}`}>
      <div className="mb-chrome">
        <span className={`mb-lock${check?.ok ? " ok" : check ? " bad" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 16 16" width="13" height="13"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9v6.5h-9z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </span>
        <span className="mb-host">{host(target)}</span>
        <button type="button" className="mb-ext" onClick={() => openWindow(target)} title="Open in its own window">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="mb-close" onClick={onClose} aria-label="Close the mini browser">×</button>
      </div>
      <div className="mb-body">
        {!check && (
          <div className="mb-state">
            <span className="mb-spin" aria-hidden="true" />
            <b>Checking {host(url)} is live…</b>
            <p>Making sure the site answers and isn&rsquo;t parked or broken before you book there.</p>
          </div>
        )}
        {check && !check.ok && (
          <div className="mb-state bad">
            <b>{title}: the website isn&rsquo;t working</b>
            <p>{check.reason ?? "It didn't answer properly."} Calling or emailing them is the better way to book.</p>
            <button type="button" className="mb-btn ghost" onClick={() => openWindow(url)}>Try it anyway</button>
          </div>
        )}
        {check?.ok && check.embeddable && <iframe className="mb-frame" src={target} title={`Booking: ${title}`} referrerPolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" />}
        {check?.ok && !check.embeddable && (
          <div className="mb-state good">
            <b>{check.unconfirmed ? "The site is slow to answer" : `The site is live${check.ms ? ` (answered in ${(check.ms / 1000).toFixed(1)} s)` : ""}`}</b>
            {check.unconfirmed && <p>I couldn&rsquo;t confirm it in time, but it may still work.</p>}
            <p>{host(target)} doesn&rsquo;t allow being shown inside other apps, so it opens in a small window next to your trip. Your dates and party size are already in the link where the site supports it.</p>
            <button type="button" className="mb-btn" onClick={() => openWindow(target)}>Open {host(target)}</button>
          </div>
        )}
      </div>
    </div>,
    root
  );
}
