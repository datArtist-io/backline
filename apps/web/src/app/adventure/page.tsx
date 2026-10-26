"use client";
// A playable demo of the adventure map on illustrative sample data (labelled as such), so the map
// can be tried without running a mission. Add ?live=1 to watch the agent "scan" and the world build.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { StepProgress } from "@backline/engine";
import AdventureView, { type MissionStep } from "./AdventureView";
import { buildAdventure } from "./model";
import { sampleSource } from "./sample";

const STEPS = ["trip.taste", "trip.flights", "trip.agent", "trip.plan", "trip.routes", "trip.intel"];
const FEED: StepProgress[] = [
  { kind: "think", text: "Burna Boy and Afrobeats: look for live music, suya and art around Victoria Island." },
  { kind: "act", id: "1", tool: "locate", text: "Locating Lagos" },
  { kind: "saw", id: "1", text: "Lagos, Nigeria · 6.45°N 3.40°E", ok: true },
  { kind: "act", id: "2", tool: "search_places", text: "Searching Qloo for venues" },
  { kind: "saw", id: "2", text: "12 venues, New Afrika Shrine matches 95%", ok: true },
  { kind: "act", id: "3", tool: "research", text: "Reading the web for entry rules and guides" },
  { kind: "saw", id: "3", text: "7 sources read", ok: true },
];

export default function Page() {
  const [live, setLive] = useState(false);
  const [stage, setStage] = useState(99);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("live")) {
      setLive(true);
      setStage(0);
    }
  }, []);
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setStage((s) => (s >= 8 ? s : s + 1)), 2600);
    return () => window.clearInterval(t);
  }, [live]);
  const src = useMemo(() => sampleSource(), []);
  const model = useMemo(() => {
    if (stage < 2) return null;
    return buildAdventure({ ...src, plan: stage >= 5 ? src.plan : null, routes: stage >= 6 ? src.routes : null, taste: stage >= 3 ? src.taste : null, intel: stage >= 7 ? src.intel : null });
  }, [src, stage]);
  const steps: MissionStep[] = STEPS.map((id, i) => ({ id, title: id, status: stage > i + 1 ? "succeeded" : stage >= i ? "running" : "pending" }));
  return (
    <main style={{ minHeight: "100svh", padding: "18px clamp(12px, 3vw, 36px) 48px", background: "var(--mist, #eef1f8)" }}>
      <p style={{ margin: "0 0 12px" }}>
        <Link href="/">← Backline</Link>
      </p>
      <AdventureView model={model} steps={steps} activity={FEED.slice(0, Math.max(0, Math.min(FEED.length, stage + 1)))} scanning={stage < 8} intelPending={stage < 7} note="Illustrative sample trip. Run a real plan to see your own." />
    </main>
  );
}
