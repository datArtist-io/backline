// Backline Wallet (demo balance), server-side. Every change goes through the database functions in
// migration 0006, as the signed-in person, so balances are checked and locked in the database.
import { rest } from "./supabase";
import type { Session } from "./session";

export type WalletEntry = { id: string; kind: "topup" | "payment"; status: "credited" | "held" | "paid" | "void"; amount_minor: number; original_amount: number | null; original_currency: string | null; label: string; ref: string | null; created_at: string };
export type Wallet = { ready: boolean; balance: number; entries: WalletEntry[]; currency: string; perUsd: number };

/** The currency people pay in, by country (from their connection) when they haven't chosen one. */
const COUNTRY_CURRENCY: Record<string, string> = {
  NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", EG: "EGP", MA: "MAD", US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS",
  GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", PT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", GR: "EUR", FI: "EUR",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", TR: "TRY", AE: "AED", SA: "SAR", QA: "QAR", IL: "ILS",
  IN: "INR", PK: "PKR", BD: "BDT", CN: "CNY", JP: "JPY", KR: "KRW", SG: "SGD", MY: "MYR", ID: "IDR", TH: "THB", PH: "PHP", VN: "VND",
  AU: "AUD", NZ: "NZD",
};
export function localCurrency(chosen: string | null | undefined, country: string | null | undefined): string {
  const c = chosen?.trim().toUpperCase();
  if (c && /^[A-Z]{3}$/.test(c)) return c;
  return COUNTRY_CURRENCY[(country ?? "").toUpperCase()] ?? "USD";
}

const rpc = <T>(s: Session, fn: string, body: Record<string, unknown> = {}) => rest<T>(s.cfg, s.accessToken, `rpc/${fn}`, { method: "POST", body });

/** The balance (US cents) and the latest entries; ready is false until the migration has run. */
export async function loadWallet(s: Session, currency = "USD"): Promise<Wallet> {
  try {
    // First open: the $20,000 welcome balance (granted once, in the database).
    await rpc<number>(s, "wallet_welcome").catch(() => undefined);
    const per = currency === "USD" ? 1 : ((await usdRates())?.[currency] ?? null);
    const shown = per ? currency : "USD";
    const [balance, entries] = await Promise.all([
      rpc<number>(s, "wallet_balance"),
      rest<WalletEntry[]>(s.cfg, s.accessToken, "wallet_entries?select=id,kind,status,amount_minor,original_amount,original_currency,label,ref,created_at&order=created_at.desc&limit=30"),
    ]);
    return { ready: true, balance: Number(balance) || 0, entries, currency: shown, perUsd: per ?? 1 };
  } catch (err) {
    if (/404|PGRST202|PGRST205|does not exist/i.test(String(err))) return { ready: false, balance: 0, entries: [], currency: "USD", perUsd: 1 };
    throw err;
  }
}

export const topUp = (s: Session, cents: number) => rpc<number>(s, "wallet_topup", { amount_minor: Math.round(cents) });

// ---------- currency ----------

let fx: { at: number; usd: Record<string, number> } | null = null;
/** Units of each currency per US dollar (open.er-api.com, cached for 6 hours). */
async function usdRates(): Promise<Record<string, number> | null> {
  if (fx && Date.now() - fx.at < 6 * 3600_000) return fx.usd;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { result?: string; rates?: Record<string, number> };
    if (j.result === "success" && j.rates) fx = { at: Date.now(), usd: j.rates };
  } catch {
    /* keep the last rates */
  }
  return fx?.usd ?? null;
}

/** An amount in any currency as US cents, or null when the rate isn't known. */
export async function toUsdCents(amount: number, currency: string): Promise<number | null> {
  const c = currency.toUpperCase();
  if (c === "USD") return Math.round(amount * 100);
  const rates = await usdRates();
  const per = rates?.[c];
  return per ? Math.round((amount / per) * 100) : null;
}

/** The engine's wallet hook for one signed-in person's mission. */
export function walletFor(s: Session) {
  return {
    async hold(amount: number, currency: string, label: string): Promise<{ ok: true; id: string; usd: number } | { ok: false; reason: string }> {
      const cents = await toUsdCents(amount, currency);
      if (cents == null) return { ok: false, reason: `I couldn't convert ${currency} for your wallet just now.` };
      const id = await rpc<string | null>(s, "wallet_hold", { amount_minor: cents, label, original_amount: Math.round(amount * 100) / 100, original_currency: currency.toUpperCase() });
      if (!id) return { ok: false, reason: `Your Backline Wallet needs $${(cents / 100).toFixed(2)} for this. Add funds in your wallet and approve again.` };
      return { ok: true, id, usd: cents };
    },
    capture: (id: string, ref: string | null) => rpc<void>(s, "wallet_capture", { entry: id, reference: ref }),
    release: (id: string) => rpc<void>(s, "wallet_release", { entry: id }),
  };
}
