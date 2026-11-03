// The currency every price is shown in: US dollars unless the traveller picks another in the top bar
// (or in their wallet; both are the same choice). Prices keep their own currency underneath and are
// converted only for display, with the day's rates.
import { useEffect, useState } from "react";

const KEY = "backline.walletCurrency";
const EVENT = "bl:currency";
export const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR", "CAD", "AED", "JPY", "INR", "AUD"];

let rates: Record<string, number> | null = null;
let loading: Promise<void> | null = null;

export function displayCurrency(): string {
  try {
    const c = localStorage.getItem(KEY);
    if (c && /^[A-Z]{3}$/.test(c)) return c;
  } catch {
    /* storage blocked, or on the server */
  }
  return "USD";
}

export function setDisplayCurrency(c: string): void {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* this visit only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: c }));
}

/** Units of each currency per US dollar, fetched once per visit. */
export function loadRates(): Promise<void> {
  if (rates || typeof window === "undefined") return Promise.resolve();
  loading ??= fetch("/api/fx")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { rates?: Record<string, number> } | null) => {
      if (j?.rates) rates = j.rates;
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** An amount in another currency, or null when there's no rate for either side. Pure given the rates. */
export function convert(n: number, from: string, to: string, table: Record<string, number> | null = rates): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return n;
  const a = table?.[f];
  const b = table?.[t];
  return a && b ? (n / a) * b : null;
}

const fmt = (n: number, currency: string, symbol: boolean) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: symbol ? "narrowSymbol" : "symbol", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString("en")} ${currency}`;
  }
};

/** A price in the chosen currency; in its own currency until the rates have loaded. */
export function formatMoney(n: number, from: string, opts: { symbol?: boolean } = {}): string {
  const to = displayCurrency();
  const v = convert(n, from, to);
  return v == null ? fmt(n, from, opts.symbol !== false) : fmt(v, to, opts.symbol !== false);
}

/** The chosen currency, re-rendering when it changes anywhere on the page or the rates arrive. */
export function useDisplayCurrency(): [string, (c: string) => void] {
  const [c, setC] = useState("USD");
  const [, setReady] = useState(0);
  useEffect(() => {
    setC(displayCurrency());
    void loadRates().then(() => setReady((n) => n + 1));
    const on = (e: Event) => setC((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [c, setDisplayCurrency];
}

export const onCurrencyChange = (fn: (c: string) => void) => {
  const on = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
};
