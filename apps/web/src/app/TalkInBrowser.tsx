"use client";
// "Talk to Backline": the same AI travel agent as the phone line, as a voice call in the browser.
// No phone network, so it works from anywhere. Say where and what you love; when the agent plans the
// trip, it opens right here. Uses Vapi's web SDK with the public key (safe in the page by design).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY ?? "";

type Trip = { code: string; destination: string | null; days: number | null; travellers: number | null; loves: string | null; url: string | null };
type State = "idle" | "connecting" | "live" | "ended" | "error";
type VapiLike = { on: (e: string, f: (x: never) => void) => unknown; start: (a: unknown) => Promise<{ id?: string } | null>; stop: () => void };

const local = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");

export default function TalkInBrowser() {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [line, setLine] = useState<{ who: "agent" | "you"; text: string } | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const vapi = useRef<VapiLike | null>(null);
  const tripRef = useRef<Trip | null>(null);
  tripRef.current = trip;

  useEffect(() => () => vapi.current?.stop(), []);

  // Watch for the trip the agent plans on this call.
  useEffect(() => {
    if (!callId || trip) return;
    let stop = false;
    let n = 0;
    const tick = async () => {
      const d = await fetch(`/api/call-trips?call=${callId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (stop) return;
      if (d?.trip?.url) setTrip(d.trip);
      else if (++n < 150) window.setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [callId, trip]);

  if (!KEY) return null;

  const start = async () => {
    setState("connecting");
    setError(null);
    setTrip(null);
    setLine(null);
    try {
      const [{ default: Vapi }, cfg] = await Promise.all([import("@vapi-ai/web"), fetch("/api/vapi/assistant", { cache: "no-store" }).then((r) => r.json())]);
      const v = new Vapi(KEY) as unknown as VapiLike;
      vapi.current = v;
      v.on("call-start", () => setState("live"));
      v.on("speech-start", () => setSpeaking(true));
      v.on("speech-end", () => setSpeaking(false));
      v.on("volume-level", ((x: number) => setLevel(x)) as never);
      v.on("message", ((m: { type?: string; transcriptType?: string; role?: string; transcript?: string }) => {
        if (m.type === "transcript" && m.transcriptType === "final" && m.transcript) setLine({ who: m.role === "assistant" ? "agent" : "you", text: m.transcript });
      }) as never);
      v.on("call-end", () => {
        setState("ended");
        setSpeaking(false);
        setLevel(0);
        // The agent said the trip is opening on screen: open it.
        const t = tripRef.current;
        if (t?.url) window.setTimeout(() => router.push(local(t.url!)), 900);
      });
      v.on("error", ((e: unknown) => {
        console.warn("[talk] call error", e);
        setState((s) => (s === "live" ? "ended" : "error"));
        setError("The call couldn't connect. Check your microphone and try again.");
      }) as never);
      const call = await v.start(cfg.assistant);
      if (call?.id) setCallId(call.id);
    } catch (e) {
      console.warn("[talk] start failed", e);
      setState("error");
      setError(/permission|notallowed/i.test(String(e)) ? "Allow the microphone to talk to Backline." : "The call couldn't start. Try again in a moment.");
    }
  };

  const end = () => vapi.current?.stop();
  const live = state === "connecting" || state === "live";

  return (
    <div className={`talk${live ? " is-live" : ""}`}>
      {!live ? (
        <button type="button" className="talk-go" onClick={start}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          {state === "ended" ? "Talk again" : "Start talking"}
        </button>
      ) : (
        <div className="talk-live" role="status" aria-live="polite">
          <span className={`talk-orb${speaking ? " is-agent" : ""}`} style={{ ["--lv" as string]: String(Math.min(1, level * 2.2)) }} aria-hidden="true" />
          <div className="talk-text">
            <b>{state === "connecting" ? "Connecting…" : speaking ? "Backline is talking" : "Listening"}</b>
            <span>{line ? `${line.who === "agent" ? "Backline" : "You"}: ${line.text}` : state === "connecting" ? "Allow the microphone if your browser asks." : "Say where you want to go and what you love."}</span>
          </div>
          <button type="button" className="talk-end" onClick={end}>End</button>
        </div>
      )}
      {trip?.url && (
        <a className="talk-trip" href={local(trip.url)}>
          <span className="callin-code">{trip.code}</span>
          <span><b>{trip.destination}</b> is ready to open</span>
          <i aria-hidden="true">→</i>
        </a>
      )}
      {error && <p className="talk-err">{error}</p>}
    </div>
  );
}
