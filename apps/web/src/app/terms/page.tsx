import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Terms of use" };

const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function TermsPage() {
  return (
    <>
      <header className="nav">
        <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
      </header>
      <main className="doc">
        <h1>Terms of use</h1>
        <p className="doc-meta">Last updated 4 November 2026 · See also the <Link href="/privacy">privacy notice</Link> and <Link href="/security">security</Link></p>

        <h2>What Backline is</h2>
        <p>Backline is an AI agent that plans trips from one sentence: it researches places, prices and events, writes a plan, and, once you approve, books, emails and calls on your behalf. It is an early product, run as a demo. By using it you agree to these terms.</p>

        <h2>An AI does the work</h2>
        <p>Plans are researched and written by AI models working with live data (taste data from Qloo, maps, flight and hotel prices, web sources). They can be wrong: a place can close, a price can change, an event can move. Check anything that matters before you travel. Every pick shows where it came from. Phone calls are made by an AI voice assistant that says so at the start of the call.</p>

        <h2>Prices</h2>
        <p>Prices on a payment slip come from the provider for your dates (an airline fare, a hotel&apos;s rate) or are labelled as an estimate with how they were worked out. A price is never made up by the AI. When there is no real fare for your dates, flights aren&apos;t charged and you get a link to compare fares instead. Prices can change between planning and booking; if a booking would cost more than you approved, it stops and asks you.</p>

        <h2>Your approval</h2>
        <p>Nothing is booked, paid, emailed or called until you approve the payment slip. Approval covers exactly what was on that slip, within its total. You can untick anything before approving.</p>

        <h2>The demo wallet, refunds and cancellations</h2>
        <p>The Backline Wallet holds a demo balance. No real money moves through it, and it can&apos;t be withdrawn or exchanged. Bookings made in demo mode get a reference marked as a demo, and no ticket or room is issued by the airline or hotel. A call that doesn&apos;t confirm its booking is refunded to the wallet automatically. When real bookings are switched on, the airline&apos;s or hotel&apos;s own fare and cancellation rules apply, and they&apos;re shown before you approve.</p>

        <h2>Using it fairly</h2>
        <p>Don&apos;t use Backline to harass a business or a person, to make bookings you don&apos;t intend to keep, to impersonate someone, to give false identity or passport details, or to break the law. Don&apos;t try to get around its limits (calls, emails and bookings per trip), probe it for others&apos; data, or overload it. Demo calls ring only your own phone. We can limit or close an account that breaks these rules.</p>

        <h2>Your account and content</h2>
        <p>You&apos;re responsible for the details you give (they&apos;re used to book in your name) and for keeping access to your email or Google account safe. What you write and upload stays yours; you let us use it to provide the service, as the <Link href="/privacy">privacy notice</Link> describes. Accounts are for people 18 and over.</p>

        <h2>Other services</h2>
        <p>Backline works through other companies: airlines and hotel providers, Qloo, map and search services, and calling and email providers. Their own terms apply to what they do, and we aren&apos;t responsible for their availability or their decisions, such as an airline changing a flight.</p>

        <h2>No guarantees</h2>
        <p>Backline is provided as it is, while it&apos;s being built. To the extent the law allows, we aren&apos;t liable for losses from relying on a plan, from a third party&apos;s service, or from the service being unavailable. Nothing here limits rights you have by law that can&apos;t be limited.</p>

        <h2>Changes</h2>
        <p>We may update these terms as the product changes; the date at the top shows the latest version. Using Backline after a change means you accept it.</p>

        <h2>Contact</h2>
        <p>
          {contact ? (
            <>Questions or complaints: <a href={`mailto:${contact}`}>{contact}</a>.</>
          ) : (
            <>Questions or complaints: reply to any email from us.</>
          )}{" "}
          Security issues: see <Link href="/security">security</Link>.
        </p>
      </main>
    </>
  );
}
