"use client";
// Verify your identity with Persona (government ID and a selfie). Runs Persona's own secure flow; the
// result is read from Persona by our server, never trusted from the browser.
import { useCallback, useEffect, useState } from "react";
import "../adventure/adventure.css";

type K = { configured: boolean; status: "none" | "pending" | "verified" | "declined" | "review"; referenceId: string };

const TEXT: Record<K["status"], { title: string; body: string }> = {
  none: { title: "Verify your identity", body: "Some bookings (flights, hotels that need ID) ask for a verified traveller. It takes about two minutes with your passport or ID and a selfie." },
  pending: { title: "Verification in progress", body: "Persona is checking your documents. This usually takes under a minute." },
  verified: { title: "Identity verified", body: "Your ID is verified, so bookings that need it can go ahead." },
  review: { title: "Being reviewed", body: "Persona is taking a closer look. You'll be able to book once it's approved." },
  declined: { title: "Verification didn't pass", body: "Try again with a clear photo of a valid document." },
};

export default function Verify({ compact = false, always = false }: { compact?: boolean; always?: boolean }) {
  const [k, setK] = useState<K | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/kyc", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setK).catch(() => setK(null)), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!k?.configured) {
    if (!always) return null;
    return (
      <section className="kyc is-none" aria-live="polite">
        <span className="kyc-badge" aria-hidden="true">ID</span>
        <div>
          <b>{k ? "Verification opens shortly" : "Checking…"}</b>
          <ol className="kyc-steps">
            <li>Photo of your passport or national ID</li>
            <li>A short selfie, matched to the photo</li>
            <li>Persona confirms it in about a minute</li>
          </ol>
        </div>
        <button type="button" className="kyc-btn" disabled>Verify now</button>
      </section>
    );
  }
  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { default: Persona } = await import("persona");
      const client = new Persona.Client({
        templateId: process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID!,
        ...(process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID ? { environmentId: process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID } : { environment: "sandbox" as const }),
        referenceId: k.referenceId,
        onReady: () => {
          setBusy(false);
          client.open();
        },
        onComplete: async ({ inquiryId }: { inquiryId: string }) => {
          const r = await fetch("/api/kyc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inquiryId }) });
          const d = await r.json().catch(() => ({}));
          if (r.ok) setK({ ...k, ...d });
          else setMsg(d.error ?? "Couldn't save the verification.");
        },
        onCancel: () => setBusy(false),
        onError: () => {
          setBusy(false);
          setMsg("The verification couldn't start. Try again.");
        },
      });
    } catch {
      setBusy(false);
      setMsg("The verification couldn't start. Try again.");
    }
  };
  const t = TEXT[k.status];
  return (
    <section className={`kyc is-${k.status}${compact ? " is-compact" : ""}`} aria-live="polite">
      <span className="kyc-badge" aria-hidden="true">{k.status === "verified" ? "✓" : "ID"}</span>
      <div>
        <b>{t.title}</b>
        {!compact && <p>{t.body}</p>}
        {!compact && (k.status === "none" || k.status === "declined") && (
          <ol className="kyc-steps">
            <li>Photo of your passport or national ID</li>
            <li>A short selfie, matched to the photo</li>
            <li>Persona confirms it in about a minute</li>
          </ol>
        )}
        {msg && <p className="kyc-msg">{msg}</p>}
      </div>
      {(k.status === "none" || k.status === "declined") && (
        <button type="button" className="kyc-btn" onClick={start} disabled={busy}>
          {busy ? "Opening…" : k.status === "declined" ? "Try again" : "Verify now"}
        </button>
      )}
      {(k.status === "pending" || k.status === "review") && <button type="button" className="kyc-btn ghost" onClick={load}>Refresh</button>}
    </section>
  );
}
