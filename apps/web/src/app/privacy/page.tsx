import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Privacy notice" };

const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

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
        <p className="doc-meta">Accounts · last updated 23 October 2026</p>

        <h2>What we collect</h2>
        <p>If you sign in: your email address and, from Google, your name and profile picture. The traveller details you choose to save (name as on your passport, phone, home city, date of birth, gender, currency, dietary needs and the things you love). Your search history (what you ask it). A record of each trip it books for you, and what it learns from them: the tastes you name, the cities you visit and the hotels you stay at. If you don&apos;t sign in, your details stay in your browser.</p>

        <h2>Why</h2>
        <p>To book flights, rooms and tables in your name, to keep your trips in one place, and to plan the next trip around what you like. Our legal basis is providing the service you asked for.</p>

        <h2>What we don&apos;t do</h2>
        <p>We don&apos;t sell your data or share it with advertisers. We never see your card details: payments go through the booking provider. Passwords aren&apos;t stored; you sign in with Google or a one-tap email link.</p>

        <h2>Who processes it</h2>
        <p>Your account is stored with our database and sign-in provider (Supabase). When it books for you, the details needed for that booking go to the airline or hotel booking provider (Duffel, LiteAPI). They act on our instructions or under their own terms for the booking.</p>

        <h2>How long we keep it</h2>
        <p>Until you remove it. You can edit your details, forget anything it remembers, clear your search history and delete any trip from your account page at any time.</p>

        <h2>Your rights</h2>
        <p>
          You can ask to see, correct or delete your data, or withdraw consent, under the Nigeria Data Protection Act, the GDPR and similar laws.{" "}
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
