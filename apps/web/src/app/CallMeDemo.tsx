"use client";
// "Hear it call you": proof the calls are real. Type your number, agree, and Backline's AI agent
// rings you within seconds for a short demo (you play a restaurant; it books a table).
import { useEffect, useState } from "react";

type State = "idle" | "placing" | "ringing" | "talking" | "ended" | "error";
const TEXT: Record<State, string> = {
  idle: "",
  placing: "Placing the call…",
  ringing: "Your phone should be ringing now. Pick up!",
  talking: "You're on the call with Backline's agent.",
  ended: "Call finished. That was a real AI call, the same way Backline books your trip.",
  error: "",
};

export default function CallMeDemo() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [ok, setOk] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const valid = /^\+?[\d\s().-]{8,20}$/.test(phone.trim()) && ok;

  useEffect(() => {
    if (!id) return;
    let stop = false;
    let n = 0;
    const tick = async () => {
      const d = await fetch(`/api/demo-call?id=${id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (stop) return;
      if (d?.state === "ringing" || d?.state === "talking" || d?.state === "ended") setState(d.state);
      if (d?.state !== "ended" && ++n < 80) setTimeout(tick, 2500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [id]);

  const call = async () => {
    setState("placing");
    setMsg(null);
    try {
      const r = await fetch("/api/demo-call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, consent: true, name: name || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setId(d.id);
      setState("ringing");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "The call couldn't be placed.");
    }
  };

  const busy = state === "placing" || state === "ringing" || state === "talking";
  return (
    <section className="callme" aria-labelledby="callme-h">
      <div className="callme-card lg">
        <div className="callme-copy">
          <p className="eyebrow">Live demo</p>
          <h2 id="callme-h">Hear it make a real call</h2>
          <p>Backline's agent calls hotels and restaurants to book your trip. Give it your number and it calls <b>you</b> in seconds: play the restaurant and listen to it book a table.</p>
        </div>
        <form className="callme-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) call(); }}>
          <div className="callme-row">
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="Your phone, e.g. +234 811 000 0000" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Your phone number" maxLength={30} disabled={busy} />
            <input type="text" autoComplete="given-name" placeholder="First name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your first name" maxLength={40} disabled={busy} />
          </div>
          <label className="callme-consent">
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} disabled={busy} />
            <span>This is my number and I agree to one short AI demo call (about two minutes).</span>
          </label>
          <button type="submit" className={`callme-go${busy ? " is-busy" : ""}`} disabled={!valid || busy}>
            <span className="callme-ring" aria-hidden="true" />
            {state === "placing" ? "Calling…" : busy ? "On its way" : "Call me now"}
          </button>
          {(TEXT[state] || msg) && <p className={`callme-status is-${state}`} role="status">{msg ?? TEXT[state]}</p>}
        </form>
      </div>
    </section>
  );
}
