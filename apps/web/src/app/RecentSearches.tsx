"use client";
// The signed-in person's last few searches under the prompt, one tap to run again.
import { useEffect, useState } from "react";

type Search = { id: string; query: string };

export default function RecentSearches({ onPick }: { onPick: (query: string) => void }) {
  const [items, setItems] = useState<Search[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/account/searches?limit=8", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { searches: [] }))
      .then((j: { searches?: Search[] }) => {
        if (!live) return;
        const seen = new Set<string>();
        setItems((j.searches ?? []).filter((s) => !seen.has(s.query.toLowerCase()) && seen.add(s.query.toLowerCase())).slice(0, 4));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!items.length) return null;
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
