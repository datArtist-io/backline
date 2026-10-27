"use client";
// Backline Wallet: the demo balance the agent pays from once you approve a trip. Tap the card to turn it
// over, switch the currency, add any amount, filter the activity, and open any payment for its receipt.
import { useCallback, useEffect, useMemo, useState } from "react";
import "../adventure/adventure.css";

type Entry = { id: string; kind: "topup" | "payment"; status: "credited" | "held" | "paid" | "void"; amount_minor: number; original_amount: number | null; original_currency: string | null; label: string; ref: string | null; details?: Record<string, unknown>; created_at: string };
type W = { ready: boolean; balance: number; entries: Entry[]; currency: string; perUsd: number };

/** US cents shown in the person's own currency. */
const moneyIn = (w: Pick<W, "currency" | "perUsd">) => (cents: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: w.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: w.perUsd > 50 ? 0 : 2 }).format((cents / 100) * w.perUsd);
export const walletMoney = (w: Pick<W, "currency" | "perUsd">) => moneyIn(w);
const STATUS: Record<Entry["status"], string> = { credited: "Added", held: "On hold", paid: "Paid", void: "Refunded" };
const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR", "CAD", "AED", "JPY", "INR", "AUD"];
const FILTERS = [
  { id: "all", label: "All" },
  { id: "paid", label: "Payments" },
  { id: "added", label: "Added" },
  { id: "refunded", label: "Refunds" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);

let chosenCurrency: string | null = null;
const pick = () => {
  if (chosenCurrency) return chosenCurrency;
  try {
    return localStorage.getItem("backline.walletCurrency");
  } catch {
    return null;
  }
};

export function useWallet() {
  const [w, setW] = useState<W | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async (currency?: string | null) => {
    try {
      const c = currency ?? pick();
      const r = await fetch(`/api/wallet${c ? `?currency=${c}` : ""}`, { cache: "no-store" });
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
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  const [custom, setCustom] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const t = setInterval(() => load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  const entries = useMemo(() => {
    const all = w?.entries ?? [];
    return all.filter((e) => (filter === "all" ? true : filter === "paid" ? e.kind === "payment" && e.status !== "void" : filter === "added" ? e.kind === "topup" : e.kind === "payment" && e.status === "void"));
  }, [w, filter]);

  const add = async (dollars: number, key: string) => {
    if (!w) return;
    setBusy(key);
    setMsg(null);
    try {
      const r = await fetch(`/api/wallet?currency=${w.currency}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dollars }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setW(d);
      setMsg(`${moneyIn(d)(dollars * 100)} added.`);
      setCustom("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't add funds.");
    } finally {
      setBusy(null);
    }
  };
  const switchTo = (c: string) => {
    chosenCurrency = c;
    try {
      localStorage.setItem("backline.walletCurrency", c);
    } catch {
      /* this visit only */
    }
    load(c);
  };

  if (err && !w) return <p className="wl-note">{err}</p>;
  if (!w) return <div className="wl-card is-loading" aria-busy="true" />;
  if (!w.ready) return <div className="wl-card is-loading"><div className="wl-card-top"><span className="wl-brand">Backline Wallet</span></div><div className="wl-bal"><small>Setting up your wallet…</small></div></div>;
  const usd = moneyIn(w);
  const held = w.entries.filter((e) => e.status === "held").reduce((n, e) => n + e.amount_minor, 0);
  const spent = w.entries.filter((e) => e.kind === "payment" && e.status === "paid").reduce((n, e) => n + e.amount_minor, 0);
  const receipts = w.entries.filter((e) => e.kind === "payment" && e.status !== "held").length;
  const since = w.entries.length ? new Date(w.entries[w.entries.length - 1].created_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null;
  // Custom amount, typed in the shown currency, sent as whole US dollars (the wallet's ledger unit).
  const typed = Number(custom.replace(/[^\d.]/g, ""));
  const typedUsd = typed > 0 ? Math.max(1, Math.round(typed / w.perUsd)) : 0;
  const customOk = typedUsd >= 1 && typedUsd <= 1000;
  const shown = showAll ? entries : entries.slice(0, 6);
  return (
    <section className="wl" aria-label="Backline Wallet">
      <div className="wl-top">
        <div className={`wl-flip${flip ? " is-flipped" : ""}`}>
          <button type="button" className="wl-card wl-front" onClick={() => setFlip(true)} aria-label="Turn the card over" aria-hidden={flip}>
            <div className="wl-card-top">
              <span className="wl-brand">Backline Wallet</span>
              <span className="wl-test">{w.currency}</span>
            </div>
            <div className="wl-chip" aria-hidden="true" />
            <div className="wl-bal">
              <small>Available</small>
              <b key={w.balance}>{usd(w.balance)}</b>
              <span>{held > 0 ? `${usd(held)} on hold for bookings` : "Demo balance · tap to turn over"}</span>
            </div>
          </button>
          <button type="button" className="wl-card wl-back" onClick={() => setFlip(false)} aria-label="Turn the card back" aria-hidden={!flip}>
            <div className="wl-card-top"><span className="wl-brand">Card details</span></div>
            <dl className="wl-backdl">
              <div><dt>Wallet</dt><dd>BL •••• {w.entries[0]?.id.slice(0, 4).toUpperCase() ?? "0000"}</dd></div>
              <div><dt>Member since</dt><dd>{since ?? "Today"}</dd></div>
              <div><dt>Currency</dt><dd>{w.currency}{w.currency !== "USD" ? ` · $1 = ${usd(100).replace(/\.00$/, "")}` : ""}</dd></div>
              <div><dt>Limits</dt><dd>Add up to $1,000 at a time, $2,000 a day</dd></div>
            </dl>
          </button>
        </div>
        <div className="wl-side">
          <dl className="wl-stats">
            <div><dt>Paid for trips</dt><dd>{usd(spent)}</dd></div>
            <div><dt>On hold</dt><dd>{usd(held)}</dd></div>
            <div><dt>Receipts</dt><dd>{receipts}</dd></div>
          </dl>
          <div className="wl-add">
            <div className="wl-add-head">
              <span>Add funds</span>
              <label className="wl-cur">
                <span className="sr-only">Show in</span>
                <select value={w.currency} onChange={(e) => switchTo(e.target.value)} aria-label="Show my wallet in">
                  {[...new Set([w.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div>
              {[100, 250, 500].map((d) => (
                <button key={d} type="button" onClick={() => add(d, String(d))} disabled={busy != null}>
                  {busy === String(d) ? "Adding…" : `+ ${usd(d * 100)}`}
                </button>
              ))}
            </div>
            <form className="wl-custom" onSubmit={(e) => { e.preventDefault(); if (customOk) add(typedUsd, "custom"); }}>
              <input inputMode="decimal" placeholder={`Other amount in ${w.currency}`} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={`Amount in ${w.currency}`} />
              <button type="submit" disabled={!customOk || busy != null}>{busy === "custom" ? "Adding…" : "Add"}</button>
            </form>
            {custom && !customOk && <p className="wl-err">Choose up to {usd(100000)} at a time.</p>}
            {msg && <p role="status">{msg}</p>}
          </div>
        </div>
      </div>

      <div className="wl-activity">
        <div className="wl-activity-head">
          <h3>Activity</h3>
          <div className="wl-filters" role="tablist" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? "on" : ""} onClick={() => { setFilter(f.id); setShowAll(false); }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {entries.length === 0 ? (
          <p className="wl-note">{filter === "all" ? "Nothing yet. Approve a trip and each booking's payment shows here." : "Nothing here yet."}</p>
        ) : (
          <ol className="wl-list">
            {shown.map((e, i) => {
              const d = e.details ?? {};
              const isOpen = open === e.id;
              return (
                <li key={e.id} className={`is-${e.status}${isOpen ? " is-open" : ""}`} style={{ ["--i" as string]: Math.min(i, 10) }}>
                  <button type="button" className="wl-row" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                    <span className="wl-ico" aria-hidden="true">{e.kind === "topup" ? "+" : e.status === "void" ? "↺" : "↗"}</span>
                    <span className="wl-row-txt">
                      <b>{e.label}</b>
                      <small>{new Date(e.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {STATUS[e.status]}</small>
                    </span>
                    <em>{e.kind === "topup" ? "+" : e.status === "void" ? "" : "−"}{usd(e.amount_minor)}</em>
                  </button>
                  {isOpen && (
                    <div className="wl-more">
                      <dl>
                        {[
                          ["For", str(d.place)],
                          ["When", str(d.when)],
                          ["Guests", str(d.party)],
                          ["Trip", str(d.trip)],
                          ["Reference", e.ref],
                          ["Charged", e.original_amount != null && e.original_currency ? `${Number(e.original_amount).toLocaleString("en")} ${e.original_currency}` : null],
                        ]
                          .filter(([, v]) => v)
                          .map(([k, v]) => (
                            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                          ))}
                      </dl>
                      {e.kind === "payment" && <a className="wl-receipt" href={`/receipt/${e.id}`} target="_blank" rel="noopener">Open receipt ↗</a>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {entries.length > 6 && (
          <button type="button" className="account-more" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show less" : `Show all ${entries.length}`}</button>
        )}
      </div>
    </section>
  );
}
