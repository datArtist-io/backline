"use client";
// Backline Wallet: test funds the agent pays from once you approve a booking. A card with your
// balance, one-tap top-ups, and every payment held, paid or released.
import { useCallback, useEffect, useState } from "react";
import Verify from "./Verify";
import "../adventure/adventure.css";

type Entry = { id: string; kind: "topup" | "payment"; status: "credited" | "held" | "paid" | "void"; amount_minor: number; original_amount: number | null; original_currency: string | null; label: string; ref: string | null; created_at: string };
type W = { ready: boolean; balance: number; entries: Entry[]; currency: string; perUsd: number };

/** US cents shown in the person's own currency. */
export const walletMoney = (w: Pick<W, "currency" | "perUsd">) => moneyIn(w);
const moneyIn = (w: Pick<W, "currency" | "perUsd">) => (cents: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: w.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: w.perUsd > 50 ? 0 : 2 }).format((cents / 100) * w.perUsd);
const STATUS: Record<Entry["status"], string> = { credited: "Added", held: "On hold", paid: "Paid", void: "Refunded" };

export function useWallet() {
  const [w, setW] = useState<W | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/wallet", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setW(d);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't load your wallet.");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { w, err, load, setW };
}

export default function WalletPanel() {
  const { w, err, load, setW } = useWallet();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);
  const add = async (dollars: number) => {
    setBusy(dollars);
    setMsg(null);
    try {
      const r = await fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dollars }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setW(d);
      setMsg(`${moneyIn(d)(dollars * 100)} added.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't add funds.");
    } finally {
      setBusy(null);
    }
  };
  if (err && !w) return <p className="wl-note">{err}</p>;
  if (!w) return <div className="wl-card is-loading" aria-busy="true" />;
  if (!w.ready) return <div className="wl-card is-loading"><div className="wl-card-top"><span className="wl-brand">Backline Wallet</span></div><div className="wl-bal"><small>Setting up your wallet…</small></div></div>;
  const usd = moneyIn(w);
  const held = w.entries.filter((e) => e.status === "held").reduce((n, e) => n + e.amount_minor, 0);
  const spent = w.entries.filter((e) => e.kind === "payment" && e.status === "paid").reduce((n, e) => n + e.amount_minor, 0);
  const receipts = w.entries.filter((e) => e.kind === "payment" && e.status !== "held").length;
  return (
    <section className="wl" aria-label="Backline Wallet">
      <div className="wl-top">
        <div className="wl-card">
          <div className="wl-card-top">
            <span className="wl-brand">Backline Wallet</span>
            <span className="wl-test">{w.currency}</span>
          </div>
          <div className="wl-chip" aria-hidden="true" />
          <div className="wl-bal">
            <small>Available</small>
            <b key={w.balance}>{usd(w.balance)}</b>
            <span>{held > 0 ? `${usd(held)} on hold for bookings` : "Demo balance"}</span>
          </div>
        </div>
        <div className="wl-side">
          <dl className="wl-stats">
            <div><dt>Paid for trips</dt><dd>{usd(spent)}</dd></div>
            <div><dt>On hold</dt><dd>{usd(held)}</dd></div>
            <div><dt>Receipts</dt><dd>{receipts}</dd></div>
          </dl>
          <div className="wl-add">
            <span>Add funds</span>
            <div>
              {[100, 250, 500].map((d) => (
                <button key={d} type="button" onClick={() => add(d)} disabled={busy != null}>
                  {busy === d ? "Adding…" : `+ ${usd(d * 100)}`}
                </button>
              ))}
            </div>
            {msg && <p role="status">{msg}</p>}
          </div>
          <p className="wl-how">Approve a trip once and each booking is paid from here, then confirmed with the place. Anything that can&rsquo;t go ahead is refunded straight away, and every payment has a receipt.</p>
        </div>
      </div>
      <Verify />
      {w.entries.length > 0 && (
        <ol className="wl-list">
          {w.entries.map((e, i) => (
            <li key={e.id} className={`is-${e.status}`} style={{ ["--i" as string]: Math.min(i, 10) }}>
              <span className="wl-ico" aria-hidden="true">{e.kind === "topup" ? "+" : "↗"}</span>
              <div>
                <b>{e.kind === "payment" ? <a href={`/receipt/${e.id}`} target="_blank" rel="noopener">{e.label}</a> : e.label}</b>
                <small>
                  {new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {STATUS[e.status]}
                  {e.original_currency && e.original_currency !== "USD" && e.original_amount ? ` · ${Number(e.original_amount).toLocaleString("en")} ${e.original_currency}` : ""}
                  {e.ref ? ` · ref ${e.ref}` : ""}
                  {e.kind === "payment" ? " · Receipt ↗" : ""}
                </small>
              </div>
              <em>{e.kind === "topup" ? "+" : "−"}{usd(e.amount_minor)}</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
