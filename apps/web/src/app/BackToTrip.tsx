"use client";
// "Back to your trip": shown on any page reached from a trip, and returns to it exactly as it was.
import Link from "next/link";
import { useEffect, useState } from "react";
import { lastTrip } from "@/lib/trip-snapshot";

export default function BackToTrip({ className = "" }: { className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => setUrl(lastTrip()), []);
  if (!url) return null;
  return (
    <Link href={url} className={`back-trip ${className}`}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Back to your trip
    </Link>
  );
}
