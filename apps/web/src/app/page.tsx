"use client";

import Link from "next/link";
import AccountButton from "./AccountButton";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Background from "./Background";
import PromptBar from "./PromptBar";
import Capabilities from "./Capabilities";
import RecentSearches from "./RecentSearches";
import TryPrompts from "./TryPrompts";
import { useMe } from "@/lib/auth-client";
import GlassFilter from "./GlassFilter";
import { Logo } from "./Logo";
import { BRAND } from "@/lib/brand";
import ModeSwitch, { type Autonomy } from "./ModeSwitch";
import { saveDocs } from "@/lib/docs";
import type { DocumentText } from "@backline/engine";

export default function Landing() {
  const router = useRouter();
  const { me, ready: meReady, configured: signInOn } = useMe();
  const [mode, setMode] = useState<Autonomy>("auto");
  const [launching, setLaunching] = useState(false);
  const [hint, setHint] = useState(0);

  useEffect(() => {
    router.prefetch("/mission");
  }, [router]);

  // A short, deliberate hand-off: the hero settles, the prompt lifts, then the mission opens.
  // Attached files travel in this tab's session storage; the URL only carries a short key.
  const go = useCallback(
    (text: string, docs: DocumentText[]) => {
      setLaunching(true);
      const key = saveDocs(docs);
      const mission = `/mission?${new URLSearchParams({ ...(text ? { goal: text } : {}), mode, ...(key ? { docs: key } : {}) })}`;
      // Signed out: sign in first (calls, payments and memory need an account), then straight into the trip.
      const url = signInOn && meReady && !me ? `/signin?${new URLSearchParams({ next: mission })}` : mission;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => router.push(url), reduce ? 0 : 420);
    },
    [router, mode, me, meReady, signInOn]
  );

  return (
    <>
      <GlassFilter />

      <header className="nav">
        <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
        <div className="nav-acts">
          <AccountButton />
        </div>
      </header>

      <main>
        <section className={`hero${launching ? " is-launching" : ""}`} aria-labelledby="hero-title">
          <Background />
          <h1 id="hero-title" className="hero-title">
            <span className="hero-line">Say where.</span>
            <span className="hero-line hero-accent">We do the rest.</span>
          </h1>
          <PromptBar onSubmit={go} placeholder="Where are you going, and when?" shortPlaceholder="Where to, and when?" />
          <ModeSwitch
            value={mode}
            onChange={(m) => {
              setMode(m);
              setHint(Date.now());
            }}
            className="hero-switch"
          />
          {/* What the chosen mode does: shown for a moment after a tap, then it fades away. */}
          {hint > 0 && (
            <p className="mode-hint" key={hint} aria-live="polite">
              {mode === "check" ? "I plan it, you review and adjust, and nothing is booked until you approve." : "I plan, call, pay and book it end to end, and show you each step live."}
            </p>
          )}
          <TryPrompts onPick={(q) => go(q, [])} extra={<RecentSearches onPick={(q) => go(q, [])} />} />
        </section>

        <Capabilities />
      </main>

      <footer className="footer">
        <Logo size={20} />
        <span>Taste data by Qloo · Maps © OpenStreetMap</span>
      </footer>
    </>
  );
}
