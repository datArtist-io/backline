import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Security", description: "How Backline keeps your money, your identity and your trips safe." };

// What protects people, in plain words. Every line here is enforced in the code (see SECURITY.md).
const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: "Your money",
    items: [
      ["Nothing is paid without your approval", "In “Check with me”, every booking waits on a payment slip you approve. The plan you approve is sealed (HMAC-SHA256), so only that exact plan can run."],
      ["Held first, charged only when confirmed", "Wallet payments are held, then captured only once the hotel or airline confirms. If a booking fails, the hold is released."],
      ["Never over budget, never twice", "A price above what you approved, or over your budget, stops for you. The same trip can't be booked twice by a refresh."],
      ["No card details here", "Payments go through the booking provider's own account. Backline never sees or stores a card number."],
      ["A ledger only you can read", "Each wallet change goes through checked database functions with a per-person lock, so nothing is spent twice."],
    ],
  },
  {
    title: "Your identity",
    items: [
      ["No passwords to steal", "Sign in with Google or a one-tap email link. Sessions live in httpOnly, Secure, SameSite cookies page scripts can't read."],
      ["Sign out everywhere", "Signing out ends your session on every device."],
      ["Passports encrypted", "AES-256-GCM before storage, bound to your account. You only ever see a masked summary; it goes only to the airline when a flight is booked."],
      ["Identity checks for paid bookings", "When switched on, paid bookings need a verified identity (Persona), checked on our server, never trusted from the browser."],
      ["Your rows are yours", "Row-level security in the database means even a server bug can't read another person's data."],
    ],
  },
  {
    title: "The AI agent",
    items: [
      ["Websites can't give it orders", "Web pages, documents and requests reach the model as quoted data with a rule that they can't change its instructions."],
      ["It can't invent places or prices", "It can only pick places its searches returned; prices and contacts are kept only if a cited page shows them."],
      ["Calls are honest and contained", "Calls say they're from an AI assistant. Demo calls only ever ring your own saved number, capped per day."],
      ["Limits on what it can do", "At most 4 emails, 8 calls and 1 room per trip, and nothing at all for someone who isn't signed in."],
    ],
  },
  {
    title: "The website",
    items: [
      ["Other sites can't act for you", "Requests that change anything are refused if they come from another website's page."],
      ["Locked-down pages", "HTTPS only (HSTS), no framing, no content sniffing, a content security policy, and microphone access only while you hold the button."],
      ["Abuse limits", "Rate limits on every API, size caps on uploads, timeouts on every outside call, and a link checker that can't be pointed at private networks."],
      ["Webhooks verified", "The calling service's webhook is checked with a shared secret."],
    ],
  },
];

export default function SecurityPage() {
  return (
    <>
      <header className="nav">
        <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
      </header>
      <main className="doc sec-doc">
        <h1>Security</h1>
        <p className="doc-meta">How {BRAND.name} keeps your money, your identity and your trips safe.</p>
        {SECTIONS.map((s) => (
          <section key={s.title} className="sec-group" aria-labelledby={`sec-${s.title}`}>
            <h2 id={`sec-${s.title}`}>{s.title}</h2>
            <ul className="sec-list">
              {s.items.map(([t, d]) => (
                <li key={t}>
                  <span className="sec-tick" aria-hidden="true" />
                  <div>
                    <b>{t}</b>
                    <p>{d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <h2>Found a problem?</h2>
        <p>Please report it privately to the maintainer rather than in public. See also the <Link href="/privacy">privacy notice</Link>.</p>
      </main>
    </>
  );
}
