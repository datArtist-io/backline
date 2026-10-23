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
            <h1 className="signin-title">Sign in to Backline</h1>
            <p className="signin-lede">Save your details once. It books in your name, keeps every trip and remembers what you like.</p>
          </div>
          <SignInForm next={safeNext} />
        </div>
      </main>
    </>
  );
}
