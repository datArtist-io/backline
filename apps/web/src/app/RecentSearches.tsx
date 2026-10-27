"use client";
// The signed-in person's recent requests, tucked into a small history dot: tap to see them, tap one to
// run it again. Nothing on screen until it's wanted.
import { useEffect, useRef, useState } from "react";

type Search = { id: string; query: string };

export default function RecentSearches({ onPick }: { onPick: (query: string) => void }) {
  const [items, setItems] = useState<Search[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/account/searches?limit=12", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { searches: [] }))
      .then((j: { searches?: Search[] }) => {
        if (!live) return;
        const seen = new Set<string>();
        setItems((j.searches ?? []).filter((s) => !seen.has(s.query.toLowerCase()) && seen.add(s.query.toLowerCase())).slice(0, 6));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  // Close on a tap outside or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", away);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div className="recent-dot-wrap" ref={box}>
      <button type="button" className={`recent-dot${open ? " on" : ""}`} aria-expanded={open} aria-label="Your recent requests" title="Recent" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7M3.5 3.8v2.6h2.6M10 6.5V10l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="recent-pop" role="menu" aria-label="Recent requests">
          <span className="recent-pop-h">Recent</span>
          {items.map((s, i) => (
            <button key={s.id} type="button" role="menuitem" style={{ ["--i" as string]: i }} onClick={() => { setOpen(false); onPick(s.query); }}>
              {s.query}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
