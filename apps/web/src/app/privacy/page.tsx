import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy notice" };

const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "backline.trips@gmail.com";

export default function PrivacyPage() {
  return (
    <>
      <header className="nav">
        <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
      </header>
      <main className="doc">
        <h1>Privacy notice</h1>
        <p className="doc-meta">Last updated 4 November 2026 · See also the <Link href="/terms">terms of use</Link></p>

        <h2>What we collect</h2>
        <p>If you sign in: your email address and, from Google, your name and profile picture. The traveller details you choose to save (name as on your passport, phone, home city, date of birth, gender, currency, dietary needs and the things you love). Your search history (what you ask it). Your passport, if you add one: encrypted before it is stored, shown to you only masked, and shared only with the airline when it books a flight for you. A record of each trip it plans or books for you, and what it learns from them: the tastes you name, the cities you visit and the hotels you stay at. Your demo wallet&apos;s ledger and receipts. If you check your identity, the result of that check (not your document images, which stay with the identity provider). If you don&apos;t sign in, your details stay in your browser.</p>

        <h2>Why</h2>
        <p>To plan trips around what you like, to book flights, rooms and tables in your name, to keep your trips in one place and in your calendar, and to plan the next trip better. Our legal basis is providing the service you asked for, and your consent for the passport and identity check.</p>

        <h2>What we don&apos;t do</h2>
        <p>We don&apos;t sell your data or share it with advertisers, and there are no ads or tracking scripts. We never see your card details. Passwords aren&apos;t stored; you sign in with Google or a one-tap email link. Your personal details are never put into an AI model&apos;s prompt beyond what a booking or call needs.</p>

        <h2>Who processes it</h2>
        <p>Your account is stored with our database and sign-in provider (Supabase). The site runs on Vercel.</p>
        <p>To plan, the words of your request (not your account details) go to the services that do the work: the AI model providers (Anthropic, Nebius, Groq), the taste data service (Qloo), web search (Tavily, Wikimedia), flight prices (Google Flights through SerpApi), hotel rates (LiteAPI), flights (Duffel), and maps (OpenStreetMap&apos;s geocoding and routing, Google&apos;s 3D map tiles). A voice note goes to the speech-to-text provider (Groq) and isn&apos;t stored.</p>
        <p>When you approve a booking, the details it needs go to the airline or hotel booking provider (Duffel, LiteAPI). When you approve an email or a call, the business&apos;s address or number, your name and the message go to the email and calling providers (Resend, Vapi, Telnyx). Calls say they&apos;re from an AI assistant. An identity check runs with Persona. Each acts on our instructions or under its own terms for the booking.</p>

        <h2>Cookies and storage</h2>
        <p>Only what the site needs to work. If you sign in, three cookies keep you signed in (<code>bl_at</code>, <code>bl_rt</code>, <code>bl_exp</code>): secure, http-only and not readable by scripts. A short-lived cookie protects the Google sign-in step. Your browser also keeps your theme, your display currency and, when signed out, your saved details. No analytics or advertising cookies, so there&apos;s nothing to consent to beyond using the site.</p>

        <h2>Your calendar</h2>
        <p>If you subscribe your calendar to your trips, the calendar app fetches a private link that lists your planned days. The link is signed so it can&apos;t be guessed; anyone you share it with can read those days, so keep it to yourself.</p>

        <h2>How long we keep it</h2>
        <p>Until you remove it. You can edit your details, remove any saved preference, clear your search history, remove your passport and delete any trip from your account page at any time. To delete your whole account and everything in it, ask us (below) and it&apos;s done within 30 days.</p>

        <h2>Children</h2>
        <p>Backline is for adults. Trips can include children, but accounts are for people 18 and over, and we don&apos;t knowingly collect data from children beyond the ages you enter so rooms are priced right.</p>

        <h2>Your rights</h2>
        <p>
          You can ask to see, correct, export or delete your data, or withdraw consent, under the GDPR, the NDPA and similar laws.{" "}
          {contact ? (
            <>Email <a href={`mailto:${contact}`}>{contact}</a> and we&apos;ll act within 30 days.</>
          ) : (
            <>Reply to any email from us and we&apos;ll act within 30 days.</>
          )}
        </p>
      </main>
    </>
  );
}
