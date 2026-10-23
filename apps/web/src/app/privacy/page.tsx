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
        <p className="doc-meta">Waitlist · last updated 22 October 2026</p>

        <h2>What we collect</h2>
        <p>Your email address and what you do (artist, manager and so on). If you choose to give them: your name, the artist or brand you work with, and where you&apos;re based. We also record when you agreed to this notice and whether you want product updates.</p>

        <h2>Why</h2>
        <p>To run the waitlist: hold your place, credit your referrals, and email you when your access is ready. If you opted in, we&apos;ll also send occasional product updates. Our legal basis is your consent, which you can withdraw at any time.</p>

        <h2>What we don&apos;t do</h2>
        <p>We don&apos;t sell your data, share it with advertisers, or store your IP address with your signup.</p>

        <h2>Who processes it</h2>
        <p>Your details are stored with our database provider (Supabase) and, if we email you, sent through our email provider (Resend). Both act on our instructions only.</p>

        <h2>How long we keep it</h2>
        <p>Until you get access or ask us to delete it. Waitlist entries we haven&apos;t contacted within 24 months are deleted.</p>

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
