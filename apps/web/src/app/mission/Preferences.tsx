"use client";
// Your preferences: what the agent knows about you. Import them from another assistant in one
// paste, or edit them directly. Saved to your account when signed in, and in this browser either way.
import { useEffect, useRef, useState } from "react";
import type { Profile } from "@backline/engine";
import { copyText } from "@/lib/actions";
import { saveProfile } from "@/lib/profile";
import { loadDetails, saveDetails, useMe } from "@/lib/auth-client";

// Same text as EXPORT_PROMPT in the engine; duplicated so the browser doesn't load the engine.
const EXPORT_PROMPT =
  "Write a summary of everything you know about me that would help a personal assistant plan trips, bookings and events for me: my name, home city, usual currency, how I like to spend (budget, mid-range or luxury), dietary needs, hotel and seating preferences, and the music, films, shows, books, food and brands I love. Use short bullet points. Leave out anything sensitive like passwords, card numbers or ID numbers.";

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default function Preferences({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (p: Profile) => void }) {
  const [p, setP] = useState<Profile>({});
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { me, ready } = useMe();
  const signedIn = Boolean(me);

  useEffect(() => {
    if (!open || !ready) return;
    loadDetails(signedIn).then(setP);
    setMsg(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    setTimeout(() => panel.current?.focus(), 30);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, ready, signedIn]);

  if (!open) return null;

  async function importIt() {
    if (paste.trim().length < 10) return setMsg("Paste the summary from your assistant first.");
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: paste }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that.");
      const merged: Profile = { ...p, ...data.profile, likes: [...new Set([...(p.likes ?? []), ...(data.profile.likes ?? [])])].slice(0, 20) };
      setP(merged);
      setPaste("");
      setMsg("Imported. Check it over, then save.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't read that.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    const ok = await saveDetails(p, signedIn);
    setBusy(false);
    if (!ok) return setMsg("Saved in this browser, but your account didn't update. Try again.");
    onSaved?.(p);
    onClose();
  }

  const field = (key: keyof Profile, label: string, placeholder = "", type = "text") => (
    <label className="pref-field">
      <span>{label}</span>
      <input type={type} value={(p[key] as string) ?? ""} placeholder={placeholder} onChange={(e) => setP({ ...p, [key]: e.target.value })} maxLength={key === "notes" ? 600 : 120} />
    </label>
  );
  const listField = (key: "likes" | "dietary" | "stayPrefs", label: string, placeholder: string) => (
    <label className="pref-field">
      <span>{label}</span>
      <input value={(p[key] ?? []).join(", ")} placeholder={placeholder} onChange={(e) => setP({ ...p, [key]: list(e.target.value) })} />
    </label>
  );

  return (
    <div className="pref-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lg pref-panel" role="dialog" aria-modal="true" aria-labelledby="pref-title" tabIndex={-1} ref={panel}>
        <div className="pref-head">
          <h2 id="pref-title" className="cp-title">
            Your preferences
          </h2>
          <button type="button" className="pref-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="muted">The more I know, the less you have to say. {signedIn ? "Saved to your account." : "Saved in this browser only."}</p>

        <div className="pref-import">
          <p className="sub">Bring what your other assistant knows</p>
          <ol className="pref-steps">
            <li>
              Copy this into ChatGPT, Claude or Gemini{" "}
              <button
                type="button"
                className="act"
                onClick={async () => {
                  if (await copyText(EXPORT_PROMPT)) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }
                }}
              >
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </li>
            <li>Paste its answer here</li>
          </ol>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste the answer…" rows={4} maxLength={8000} />
          <button type="button" className="go small-go" onClick={importIt} disabled={busy}>
            {busy ? "Reading…" : "Import"}
          </button>
        </div>

        <div className="pref-grid">
          {field("name", "Name", "Your name")}
          {field("email", "Email", "For replies to bookings", "email")}
          {field("phone", "Phone", "+1 555 123 4567", "tel")}
          {field("homeCity", "Home city", "Where you live")}
          {field("birthDate", "Date of birth (for flights)", "", "date")}
          <label className="pref-field">
            <span>Gender on passport (for flights)</span>
            <select value={p.gender ?? ""} onChange={(e) => setP({ ...p, gender: (e.target.value || undefined) as Profile["gender"] })}>
              <option value="">Not set</option>
              <option value="f">Female</option>
              <option value="m">Male</option>
            </select>
          </label>
          {field("currency", "Currency", "USD, EUR, NGN…")}
          <label className="pref-field">
            <span>Spending style</span>
            <select value={p.budgetStyle ?? ""} onChange={(e) => setP({ ...p, budgetStyle: (e.target.value || undefined) as Profile["budgetStyle"] })}>
              <option value="">Not set</option>
              <option value="budget">Budget</option>
              <option value="mid">Mid-range</option>
              <option value="luxury">Luxury</option>
            </select>
          </label>
          {listField("likes", "Things you love", "Radiohead, Fleabag, Japanese food")}
          {listField("dietary", "Dietary needs", "Vegetarian, no pork")}
          {listField("stayPrefs", "Hotel preferences", "Quiet room, pool, near the beach")}
          {field("notes", "Anything else", "Travels with a toddler…")}
        </div>

        {msg && <p className="join-error">{msg}</p>}
        <div className="cp-foot">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setP({});
              if (signedIn) void saveDetails({}, true);
              else saveProfile({});
            }}
          >
            Clear everything
          </button>
          <button type="button" className="go" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
