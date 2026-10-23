import type { Metadata } from "next";
import Link from "next/link";
import Background from "../Background";
import GlassFilter from "../GlassFilter";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";
import JoinForm from "./JoinForm";

export const metadata: Metadata = {
  title: "Join the waitlist",
  description: `Get early access to ${BRAND.name}. ${BRAND.tagline}`,
};

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  const safeRef = ref && /^[a-zA-Z0-9]{8}$/.test(ref) ? ref.toLowerCase() : undefined;

  return (
    <>
      <GlassFilter />
      <header className="nav">
        <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
      </header>
      <main className="join hero">
        <Background />
        <div className="join-grid">
          <div className="join-intro">
            <h1 className="join-title">
              <span className="hero-line">Say where.</span>
              <span className="hero-line hero-accent">We do the rest.</span>
            </h1>
            <p className="join-lede">
              Trips, events, dinners and nights out: say where and when, and the agent books the flights and the hotel, pays for them, reserves the table and hands you the whole trip.
            </p>
            {safeRef ? <p className="join-invited">You were invited. Join and you both move up.</p> : null}
          </div>
          <JoinForm refCode={safeRef} />
        </div>
      </main>
    </>
  );
}
