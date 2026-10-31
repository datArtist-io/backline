"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GoogleMark } from "../AuthMarks";
import { sendEmailLink, signInAvailable, startOAuth, useMe, type Provider } from "@/lib/auth-client";
import { EMAIL_RE } from "@backline/engine";

export default function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<Provider | "email" | null>(null);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A sign-in that came back with a problem (cancelled, expired) says so here.
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) setError(e.slice(0, 160));
  }, []);
  const { providers } = useMe();
  const NAME = { google: "Google" } as const;

  const oauth = (p: Provider) => {
    if (!signInAvailable) return setError("Sign-in isn't switched on yet.");
    if (providers && !providers[p]) return setError(`${NAME[p]} sign-in is being switched on. Use your email for now; you can link ${NAME[p]} later.`);
    setBusy(p);
    startOAuth(p, next);
  };

  const emailLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError("Check your email address.");
    setBusy("email");
    setError(null);
    const r = await sendEmailLink(email.trim(), next);
    setBusy(null);
    if (r.ok) setSent(true);
    else setError(r.error ?? "That didn't work. Try again.");
  };

  // The email carries a code too: typing it here signs in on this device, wherever the email was opened.
  const verify = async (e?: React.FormEvent, value = code) => {
    e?.preventDefault();
    const c = value.replace(/\D/g, "");
    if (c.length < 6) return setError("Enter the code from the email.");
    setChecking(true);
    setError(null);
    const res = await fetch("/api/auth/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), code: c }) }).catch(() => null);
    const j = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
    if (res?.ok) {
      // The same finish as a link or Google: carry over details saved in this browser, then go on.
      window.location.assign(`/auth/callback?${new URLSearchParams({ signed: "1", next })}`);
      return;
    }
    setChecking(false);
    setError(j.error ?? "That didn't work. Try again.");
  };

  if (sent)
    return (
      <div className="lg join-card signin-card" aria-live="polite">
        <div className="join-step">
        <p className="join-step-title">Check your email</p>
        <p className="signin-sent">
          We sent a sign-in code to <strong>{email.trim()}</strong>. Enter it below, or tap the link in the same email.
        </p>
        <form className="code-row" onSubmit={verify} noValidate>
          <label htmlFor="signin-code" className="sr-only">Sign-in code</label>
          <input
            id="signin-code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            placeholder="Code"
            value={code}
            autoFocus
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 10);
              setCode(v);
              // A pasted or autofilled 6-digit code signs in straight away.
              if (v.length === 6 && !checking) void verify(undefined, v);
            }}
          />
          <button type="submit" className="code-go" disabled={checking || code.length < 6}>{checking ? "Checking…" : "Sign in"}</button>
        </form>
        {error && <p className="join-error" role="alert">{error}</p>}
        <div className="code-links">
          <button type="button" className="link-btn" disabled={busy !== null} onClick={async () => { setBusy("email"); setError(null); const r = await sendEmailLink(email.trim(), next); setBusy(null); setCode(""); if (!r.ok) setError(r.error ?? "That didn't work. Try again."); }}>
            {busy === "email" ? "Sending…" : "Send a new code"}
          </button>
          <button type="button" className="link-btn" onClick={() => { setSent(false); setCode(""); setError(null); }}>
            Use a different email
          </button>
        </div>
        </div>
      </div>
    );

  return (
    <div className="lg join-card signin-card" aria-live="polite">
      <div className="join-step">
      <p className="join-step-title">Sign in or create an account</p>
      <div className="auth-buttons">
        <button type="button" className="auth-btn google" onClick={() => oauth("google")} disabled={busy !== null}>
          <GoogleMark />
          <span>{busy === "google" ? "Opening Google…" : "Continue with Google"}</span>
        </button>
      </div>
      <div className="or" role="separator">
        <span>or</span>
      </div>
      <form className="email-row" onSubmit={emailLink} noValidate>
        <label htmlFor="signin-email" className="sr-only">
          Email
        </label>
        <input id="signin-email" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        <button type="submit" className="email-go" aria-label="Email me a sign-in link" disabled={!email.trim() || busy !== null}>
          {busy === "email" ? "…" : "→"}
        </button>
      </form>
      {error && (
        <p className="join-error" role="alert">
          {error}
        </p>
      )}
      <p className="fine">
        No password needed: we email you a sign-in code. By continuing you agree to our <Link href="/privacy">privacy notice</Link>.
      </p>
      </div>
    </div>
  );
}
