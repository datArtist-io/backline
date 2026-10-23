import type { Metadata } from "next";
import Link from "next/link";
import Background from "../Background";
import GlassFilter from "../GlassFilter";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";
import SignInForm from "./SignInForm";

export const metadata: Metadata = { title: "Sign in", description: `Sign in to ${BRAND.name} to keep your details, trips and bookings in one place.` };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
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
              <span className="hero-line">Sign in once.</span>
              <span className="hero-line hero-accent">It remembers you.</span>
            </h1>
            <p className="join-lede">Your traveller details, the things you love and every trip it books for you, kept in your account and ready on any device.</p>
          </div>
          <SignInForm next={safeNext} />
        </div>
      </main>
    </>
  );
}
