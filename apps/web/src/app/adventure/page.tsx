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
  { kind: "think", text: "Fado and jazz: look around Alfama and Bairro Alto." },
  { kind: "act", id: "1", tool: "locate", text: "Locating Lisbon" },
  { kind: "saw", id: "1", text: "Lisbon, Portugal · 38.71°N 9.14°W", ok: true },
  { kind: "act", id: "2", tool: "search_places", text: "Searching Qloo for venues" },
  { kind: "saw", id: "2", text: "14 places, Tasca do Chico matches 96%", ok: true },
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
      <AdventureView fullscreen model={model} steps={steps} scanning={stage < 8} intelPending={stage < 7} note="Illustrative sample trip. Run a real plan to see your own." />
    </main>
  );
}
