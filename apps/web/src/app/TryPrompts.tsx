"use client";
// Ready-made requests under the prompt, so a first visit knows what to say. They lean into what
// Qloo does best: taste across domains (the music, films, food and people you love, read into
// places), trips planned the way a star would, and fan trips. A fresh set every few seconds.
import { useEffect, useRef, useState } from "react";

const PROMPTS: { label: string; prompt: string }[] = [
  // The way a star would
  { label: "Dubai the way Drake would", prompt: "Plan 3 nights in Dubai for 2 the way Drake would" },
  { label: "Lagos the way Burna Boy would", prompt: "A weekend in Lagos for 2 the way Burna Boy would, afrobeats and suya" },
  { label: "Paris the way Pharrell would", prompt: "4 days in Paris for 2 the way Pharrell Williams would, fashion and music" },
  { label: "Barbados like Rihanna", prompt: "5 days in Barbados for 2 the way Rihanna would" },
  { label: "London the way Wizkid would", prompt: "A long weekend in London for 2 the way Wizkid would" },
  { label: "Seoul like a BTS member", prompt: "5 days in Seoul for 2 the way a BTS member would" },
  { label: "San Juan the way Bad Bunny would", prompt: "4 days in San Juan, Puerto Rico for 2 the way Bad Bunny would" },
  { label: "Mexico City like Frida Kahlo", prompt: "A long weekend in Mexico City for 2 the way Frida Kahlo would, art and mezcal" },
  // Taste across domains
  { label: "Tokyo like a Ghibli fan", prompt: "5 days in Tokyo for 2, I love Studio Ghibli, ramen and vinyl shops" },
  { label: "Paris for jazz and natural wine", prompt: "A long weekend in Paris for 2, we love jazz bars and natural wine" },
  { label: "Kyoto for Wes Anderson fans", prompt: "4 days in Kyoto for 2, we love Wes Anderson films, matcha and quiet design" },
  { label: "Berlin for techno and Daft Punk", prompt: "A weekend in Berlin for 2, we love Daft Punk, techno and street art" },
  { label: "Copenhagen for design lovers", prompt: "3 days in Copenhagen for 2, we love Scandinavian design and New Nordic food" },
  { label: "New Orleans for jazz and Creole", prompt: "A long weekend in New Orleans for 2, we love jazz, Creole food and live music" },
  { label: "Havana for Buena Vista fans", prompt: "4 days in Havana for 2, we love Buena Vista Social Club, cigars and vintage cars" },
  { label: "Rome for opera and pasta", prompt: "3 days in Rome for 2, we love opera and handmade pasta" },
  { label: "Lisbon for fado and seafood", prompt: "A weekend in Lisbon for 2 under €900, we love fado and seafood" },
  { label: "Rio for samba and bossa nova", prompt: "5 days in Rio de Janeiro for 2, we love samba, bossa nova and beaches" },
  { label: "Marrakech for YSL fans", prompt: "4 days in Marrakech for 2, we love Yves Saint Laurent, riads and spice markets" },
  { label: "Cape Town for wine and surf", prompt: "A week in Cape Town for 2, we love wine farms, surfing and hiking" },
  // Fan trips
  { label: "Nashville for Taylor Swift fans", prompt: "A weekend in Nashville for 2, we love Taylor Swift, country music and hot chicken" },
  { label: "Kingston for Bob Marley fans", prompt: "4 days in Kingston, Jamaica for 2, we love Bob Marley, reggae and jerk food" },
  { label: "London for Harry Potter fans", prompt: "3 days in London for 2, we love Harry Potter, afternoon tea and bookshops" },
  { label: "Barcelona for Gaudí and Messi", prompt: "4 days in Barcelona for 2, we love Gaudí, FC Barcelona and tapas" },
  { label: "Accra for afrobeats and jollof", prompt: "A long weekend in Accra for 2, we love afrobeats, highlife and jollof" },
  { label: "Seoul for K-drama fans", prompt: "5 days in Seoul for 2, we love K-dramas, Korean BBQ and skincare shopping" },
  { label: "New York for Broadway lovers", prompt: "4 days in New York for 2, we love Broadway musicals and pizza" },
  { label: "Bali honeymoon, surf and yoga", prompt: "A week in Bali for our honeymoon, we love surfing, yoga and slow food" },
  // Nights out close to home
  { label: "Lagos dinner this Friday", prompt: "Book dinner for 2 in Lagos this Friday at 8pm, I love afrobeats and suya" },
  { label: "Birthday dinner for 8", prompt: "A birthday dinner for 8 this Saturday, we love live music and Italian food" },
];

const SHOW = 3;
const EVERY = 7000;

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

export default function TryPrompts({ onPick, extra = null }: { onPick: (query: string) => void; extra?: React.ReactNode }) {
  const [order, setOrder] = useState(PROMPTS);
  const [at, setAt] = useState(0);
  const paused = useRef(false);
  // A different mix each visit (after load, so the server and browser agree on the first paint),
  // then a fresh set every few seconds; holding the pointer over them pauses it.
  useEffect(() => setOrder(shuffle(PROMPTS)), []);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (!paused.current && document.visibilityState === "visible") setAt((n) => (n + SHOW) % PROMPTS.length);
    }, EVERY);
    return () => clearInterval(t);
  }, []);
  const shown = Array.from({ length: SHOW }, (_, k) => order[(at + k) % order.length]);
  return (
    <nav className="recent try" aria-label="Try one of these" onPointerEnter={() => (paused.current = true)} onPointerLeave={() => (paused.current = false)} onFocus={() => (paused.current = true)} onBlur={() => (paused.current = false)}>
      {extra}
      <span className="recent-label">Try</span>
      {shown.map((p, i) => (
        <button key={`${at}-${p.label}`} type="button" className="recent-chip try-chip" style={{ ["--i" as string]: i }} onClick={() => onPick(p.prompt)} title={p.prompt}>
          {p.label}
        </button>
      ))}
    </nav>
  );
}
