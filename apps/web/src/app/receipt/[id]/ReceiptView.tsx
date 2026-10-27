"use client";
// A payment receipt to show on arrival: who paid, what for, when, the booking reference, and the amount.
import { useEffect, useState } from "react";
import Link from "next/link";
import "./receipt.css";

type Entry = { id: string; status: "held" | "paid" | "void"; amount_minor: number; original_amount: number | null; original_currency: string | null; label: string; ref: string | null; details: Record<string, unknown>; created_at: string };
type Data = { entry: Entry; payer: { name?: string | null; email?: string | null }; local: { currency: string; amount: number } };

const STATUS = { paid: "Paid", held: "Payment pending", void: "Refunded" } as const;
const fmt = (n: number, c: string) => new Intl.NumberFormat("en", { style: "currency", currency: c }).format(n);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);

export default function ReceiptView({ id }: { id: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/wallet/receipts/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setD(j);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load this receipt."));
  }, [id]);
  if (err) return <main className="rc-page"><div className="rc"><p>{err}</p><Link href="/account">Your account</Link></div></main>;
  if (!d) return <main className="rc-page"><div className="rc is-loading" aria-busy="true" /></main>;
  const e = d.entry;
  const det = e.details ?? {};
  const rows: [string, string | null][] = [
    ["For", str(det.place) ?? e.label],
    ["Booking", e.label],
    ["When", str(det.when)],
    ["Guests", str(det.party)],
    ["Nights", str(det.nights)],
    ["Trip", str(det.trip)],
    ["Booking reference", e.ref],
    ["Cancellation", str(det.cancellation)],
    ["Paid by", [d.payer.name, d.payer.email].filter(Boolean).join(" · ") || null],
    ["Paid on", new Date(e.created_at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })],
  ];
  const code = `${e.id.slice(0, 8)}-${e.id.slice(-4)}`.toUpperCase();
  return (
    <main className="rc-page">
      <article className="rc" aria-label="Payment receipt">
        <header>
          <span className="rc-brand">Backline</span>
          <span className={`rc-status is-${e.status}`}>{STATUS[e.status]}</span>
        </header>
        <h1>Receipt</h1>
        <p className="rc-amt">{fmt(d.local.amount, d.local.currency)}</p>
        {e.original_amount != null && e.original_currency && e.original_currency !== d.local.currency && <p className="rc-orig">{fmt(Number(e.original_amount), e.original_currency)} charged by the business</p>}
        <dl>
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <footer>
          <p>Receipt no. <code>{code}</code></p>
          <p className="rc-small">Paid from your Backline Wallet (demo balance). Show this receipt with your booking reference when you arrive.</p>
          <div className="rc-acts">
            <button type="button" onClick={() => window.print()}>Print or save as PDF</button>
            <Link href="/account?tab=wallet">All receipts</Link>
          </div>
        </footer>
      </article>
    </main>
  );
}
