"use client";
// Waitlist in two light steps: who you are (Google, Apple or email), then what you do (one tap).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import { oauthEnabled, oauthUrl, takeOauthToken, type Provider } from "@/lib/oauth";
import { AppleMark, GoogleMark } from "../AuthMarks";

const ROLES = [
  { value: "traveller", label: "I travel for fun" },
  { value: "business", label: "I travel for work" },
  { value: "host", label: "I host events" },
  { value: "agency", label: "I plan for others" },
  { value: "other", label: "Something else" },
] as const;
type Role = (typeof ROLES)[number]["value"];

type Joined = { position: number; total: number; refCode: string; referralUrl: string; emailed?: boolean };
type Identity = { email?: string; accessToken?: string; provider?: Provider | null };
type Step = { kind: "start" } | { kind: "role"; who: Identity } | { kind: "joined"; data: Joined } | { kind: "already" };

export default function JoinForm({ refCode }: { refCode?: string }) {
  const openedAt = useRef(0);
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (step.kind !== "start") setMoved(true);
  }, [step.kind]);

  useEffect(() => {
    openedAt.current = Date.now();
    // Back from Google or Apple: go straight to the last step.
    const t = takeOauthToken();
    if (t) setStep({ kind: "role", who: { accessToken: t.accessToken, provider: t.provider } });
    const err = new URLSearchParams(window.location.search).get("error_description");
    if (err) setError("Sign-in was cancelled or failed. Try again, or use your email.");
  }, []);

  function signIn(provider: Provider) {
    setError(null);
    if (!oauthEnabled) {
      setError(`${provider === "google" ? "Google" : "Apple"} sign-in isn't switched on yet. Use your email for now.`);
      return;
    }
    setBusy(provider);
    try {
      sessionStorage.setItem("backline.oauth", provider);
    } catch {
      /* ignore */
    }
    const back = `${window.location.origin}/join${refCode ? `?ref=${refCode}` : ""}`;
    window.location.assign(oauthUrl(provider, back));
  }

  function continueWithEmail(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return setError("Enter a valid email address.");
    setError(null);
    setStep({ kind: "role", who: { email: v } });
  }

  async function finish(role: Role, who: Identity) {
    setBusy(role);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: who.email, accessToken: who.accessToken, role, ref: refCode, consent: true, marketing: false, website: "", openedAt: openedAt.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "We couldn't add you just now. Try again in a moment.");
      setStep(data.already ? { kind: "already" } : { kind: "joined", data });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lg join-card" aria-live="polite" data-moved={moved ? "" : undefined}>
      {step.kind === "start" && (
        <div className="join-step" key="start">
          <p className="join-step-title">Get early access</p>
          <div className="auth-buttons">
            <button type="button" className="auth-btn google" onClick={() => signIn("google")} disabled={busy !== null}>
              <GoogleMark />
              <span>{busy === "google" ? "Opening Google…" : "Continue with Google"}</span>
            </button>
            <button type="button" className="auth-btn apple" onClick={() => signIn("apple")} disabled={busy !== null}>
              <AppleMark />
              <span>{busy === "apple" ? "Opening Apple…" : "Continue with Apple"}</span>
            </button>
          </div>
          <div className="or" role="separator">
            <span>or</span>
          </div>
          <form className="email-row" onSubmit={continueWithEmail} noValidate>
            <label htmlFor="join-email" className="sr-only">
              Email
            </label>
            <input id="join-email" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
            <button type="submit" className="email-go" aria-label="Continue with email" disabled={!email.trim()}>
              <Arrow />
            </button>
          </form>
          {error && (
            <p className="join-error" role="alert">
              {error}
            </p>
          )}
          <p className="fine">
            By continuing you agree to our <Link href="/privacy">privacy notice</Link>.
          </p>
        </div>
      )}

      {step.kind === "role" && (
        <div className="join-step" key="role">
          <button type="button" className="back" onClick={() => setStep({ kind: "start" })} aria-label="Back">
            <Arrow flip /> {step.who.email ?? (step.who.provider === "apple" ? "Signed in with Apple" : "Signed in with Google")}
          </button>
          <p className="join-step-title">What brings you here?</p>
          <div className="roles">
            {ROLES.map((r) => (
              <button key={r.value} type="button" className={`role${busy === r.value ? " is-busy" : ""}`} disabled={busy !== null} onClick={() => finish(r.value, step.who)}>
                {r.label}
              </button>
            ))}
          </div>
          {error && (
            <p className="join-error" role="alert">
              {error}
            </p>
          )}
          <p className="fine">One tap and you&rsquo;re on the list.</p>
        </div>
      )}

      {step.kind === "already" && (
        <div className="join-step" key="already">
          <p className="join-step-title">You&rsquo;re already on the list.</p>
          <p className="fine">We&rsquo;ll email you when your spot opens.</p>
          <Link href="/" className="act">
            Back to {BRAND.name}
          </Link>
        </div>
      )}

      {step.kind === "joined" && <JoinedView data={step.data} />}
    </div>
  );
}

function JoinedView({ data }: { data: Joined }) {
  const [copied, setCopied] = useState(false);
  const share = `I just joined the ${BRAND.name} waitlist. ${BRAND.tagline} Join with my link and we both move up.`;
  const enc = encodeURIComponent;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="join-step" key="joined">
      <p className="fine">You&rsquo;re in</p>
      <p className="join-pos">
        <span className="join-pos-num">#{data.position.toLocaleString()}</span>
        <span className="fine">of {data.total.toLocaleString()} on the list</span>
      </p>
      <p className="fine">Each person who joins with your link moves you up.</p>
      <div className="email-row ref-row">
        <input readOnly value={data.referralUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Your referral link" />
        <button
          type="button"
          className="copy-pill"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(data.referralUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              /* the link is selectable */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="share-row">
        {canShare && (
          <button type="button" className="share-btn" onClick={() => navigator.share({ title: BRAND.name, text: share, url: data.referralUrl }).catch(() => {})}>
            Share
          </button>
        )}
        <a className="share-btn" href={`https://wa.me/?text=${enc(`${share} ${data.referralUrl}`)}`} target="_blank" rel="noopener noreferrer">
          WhatsApp
        </a>
        <a className="share-btn" href={`https://x.com/intent/post?text=${enc(share)}&url=${enc(data.referralUrl)}`} target="_blank" rel="noopener noreferrer">
          X
        </a>
        <a className="share-btn" href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(data.referralUrl)}`} target="_blank" rel="noopener noreferrer">
          LinkedIn
        </a>
      </div>
      {data.emailed && <p className="fine">We&rsquo;ve emailed you this link too.</p>}
    </div>
  );
}

function Arrow({ flip }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
