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
  // Coming from the prompt: show what they asked for, and let them look at the plan first if they'd rather.
  let asked: string | null = null;
  if (safeNext.startsWith("/mission?")) asked = new URLSearchParams(safeNext.slice("/mission?".length)).get("goal");
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
            <h1 className="signin-title hero-accent">Sign in to Backline</h1>
            {asked ? (
              <>
                <p className="signin-lede">Sign in and I&rsquo;ll plan this, then call, pay and book it in your name:</p>
                <p className="signin-asked">&ldquo;{asked.slice(0, 200)}&rdquo;</p>
                <Link className="signin-guest" href={safeNext.replace(/([?&])mode=auto/, "$1mode=check")}>Just show me the plan first →</Link>
              </>
            ) : (
              <p className="signin-lede">Save your details once so it can book in your name, and keep all your trips in one place.</p>
            )}
          </div>
          <SignInForm next={safeNext} />
        </div>
      </main>
    </>
  );
}
