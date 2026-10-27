"use client";
// The signed-in person's last few searches under the prompt, one tap to run again.
import { useEffect, useState } from "react";

type Search = { id: string; query: string };

export default function RecentSearches({ onPick, fallback = null }: { onPick: (query: string) => void; fallback?: React.ReactNode }) {
  const [items, setItems] = useState<Search[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/account/searches?limit=8", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { searches: [] }))
      .then((j: { searches?: Search[] }) => {
        if (!live) return;
        const seen = new Set<string>();
        setItems((j.searches ?? []).filter((s) => !seen.has(s.query.toLowerCase()) && seen.add(s.query.toLowerCase())).slice(0, 3));
      })
      .catch(() => undefined)
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, []);
  // First visit (or nothing yet): show example requests instead, in the same single row.
  if (!items.length) return loaded ? <>{fallback}</> : null;
  return (
    <nav className="recent" aria-label="Your recent searches">
      <span className="recent-label">Recent</span>
      {items.map((s) => (
        <button key={s.id} type="button" className="recent-chip" onClick={() => onPick(s.query)} title={s.query}>
          {s.query}
        </button>
      ))}
    </nav>
  );
}
