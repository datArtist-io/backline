"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Background from "./Background";
import PromptBar from "./PromptBar";
import Capabilities from "./Capabilities";
import GlassFilter from "./GlassFilter";
import { Logo } from "./Logo";
import { BRAND } from "@/lib/brand";
import ModeSwitch, { type Autonomy } from "./ModeSwitch";
import { saveDocs } from "@/lib/docs";
import type { DocumentText } from "@backline/engine";

export default function Landing() {
  const router = useRouter();
  const [mode, setMode] = useState<Autonomy>("auto");
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    router.prefetch("/mission");
  }, [router]);

  // A short, deliberate hand-off: the hero settles, the prompt lifts, then the mission opens.
  // Attached files travel in this tab's session storage; the URL only carries a short key.
  const go = useCallback(
    (text: string, docs: DocumentText[]) => {
      setLaunching(true);
      const key = saveDocs(docs);
      const url = `/mission?${new URLSearchParams({ ...(text ? { goal: text } : {}), mode, ...(key ? { docs: key } : {}) })}`;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setTimeout(() => router.push(url), reduce ? 0 : 420);
    },
    [router, mode]
  );

  return (
    <>
      <GlassFilter />

      <header className="nav">
        <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
        <Link href="/join" className="lg pill">
          Get early access
        </Link>
      </header>

      <main>
        <section className={`hero${launching ? " is-launching" : ""}`} aria-labelledby="hero-title">
          <Background />
          <h1 id="hero-title" className="hero-title">
            <span className="hero-line">Say where.</span>
            <span className="hero-line hero-accent">We plan the rest.</span>
          </h1>
          <PromptBar onSubmit={go} placeholder="What are you planning, where and when?" shortPlaceholder="What are you planning?" />
          <ModeSwitch value={mode} onChange={setMode} className="hero-switch" />
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
