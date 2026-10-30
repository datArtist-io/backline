"use client";
// Anything that throws while a page renders lands here instead of a blank screen.
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page] render error", error.message);
  }, [error]);
  return (
    <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ maxWidth: 420, display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong on this page</h1>
        <p style={{ margin: 0, opacity: 0.75 }}>Your trip isn&rsquo;t lost. Try again, or start a new one.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button type="button" className="rerun" onClick={reset}>Try again</button>
          <Link href="/" className="rerun">New trip</Link>
        </div>
      </div>
    </main>
  );
}
