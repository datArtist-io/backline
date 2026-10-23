"use client";
// Where Google, Apple and email sign-in links land: finish signing in, then carry on.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { completeSignIn } from "@/lib/auth-client";

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    completeSignIn().then((r) => ("next" in r ? router.replace(r.next) : setError(r.error)));
  }, [router]);
  return (
    <main className="signin signin-wait">
      {error ? (
        <div className="lg join-card signin-card">
          <p className="join-step-title">Sign-in didn&rsquo;t finish</p>
          <p className="signin-sent">{error}</p>
          <Link className="act" href="/signin">
            Try again
          </Link>
        </div>
      ) : (
        <p className="signin-sent" aria-live="polite">
          Signing you in…
        </p>
      )}
    </main>
  );
}
