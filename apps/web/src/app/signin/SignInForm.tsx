"use client";
import Link from "next/link";
import { useState } from "react";
import { AppleMark, GoogleMark } from "../AuthMarks";
import { sendEmailLink, signInAvailable, startOAuth, useMe, type Provider } from "@/lib/auth-client";
import { EMAIL_RE } from "@backline/engine";

export default function SignInForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<Provider | "email" | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { providers } = useMe();
  const NAME = { google: "Google", apple: "Apple" } as const;

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

  if (sent)
    return (
      <div className="lg join-card signin-card" aria-live="polite">
        <div className="join-step">
        <p className="join-step-title">Check your email</p>
        <p className="signin-sent">
          We sent a sign-in link to <strong>{email.trim()}</strong>. Open it on this device to continue.
        </p>
        <button type="button" className="link-btn" onClick={() => setSent(false)}>
          Use a different email
        </button>
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
        <button type="button" className="auth-btn apple" onClick={() => oauth("apple")} disabled={busy !== null}>
          <AppleMark />
          <span>{busy === "apple" ? "Opening Apple…" : "Continue with Apple"}</span>
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
        No password needed: we email you a one-tap link. By continuing you agree to our <Link href="/privacy">privacy notice</Link>.
      </p>
      </div>
    </div>
  );
}
