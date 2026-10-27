"use client";
// Ready-made requests under the prompt, so a first visit knows what to say: the world's most loved
// places, each with a taste for Qloo to read. One tap runs it.
import { useEffect, useState } from "react";

const PROMPTS: { label: string; prompt: string }[] = [
  { label: "Paris, a long weekend for two", prompt: "A long weekend in Paris for 2, we love jazz bars and natural wine" },
  { label: "Tokyo like a Ghibli fan", prompt: "5 days in Tokyo for 2, I love Studio Ghibli, ramen and vinyl shops" },
  { label: "Dubai the way Drake would", prompt: "Plan 3 nights in Dubai for 2 the way Drake would" },
  { label: "Bali honeymoon", prompt: "A week in Bali for our honeymoon, we love surfing, yoga and slow food" },
  { label: "New York for Broadway lovers", prompt: "4 days in New York for 2, we love Broadway musicals and pizza" },
  { label: "Lagos dinner this Friday", prompt: "Book dinner for 2 in Lagos this Friday at 8pm, I love afrobeats and suya" },
  { label: "Lisbon on a budget", prompt: "A weekend in Lisbon for 2 under €900, we love fado and seafood" },
  { label: "Rome for food lovers", prompt: "3 days in Rome for 2, we love opera and handmade pasta" },
];

export default function TryPrompts({ onPick }: { onPick: (query: string) => void }) {
  const [shown, setShown] = useState(PROMPTS.slice(0, 4));
  // A different mix each visit (after load, so the server and browser agree on the first paint).
  useEffect(() => setShown([...PROMPTS].sort(() => Math.random() - 0.5).slice(0, 4)), []);
  return (
    <nav className="recent try" aria-label="Try one of these">
      <span className="recent-label">Try</span>
      {shown.map((p, i) => (
        <button key={p.label} type="button" className="recent-chip try-chip" style={{ ["--i" as string]: i }} onClick={() => onPick(p.prompt)} title={p.prompt}>
          {p.label}
        </button>
      ))}
    </nav>
  );
}
