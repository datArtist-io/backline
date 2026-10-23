"use client";
// Sign in with Ethereum (EIP-4361) from a browser wallet such as MetaMask, Rabby or Coinbase Wallet.
// The wallet signs a plain-text message naming this site; nothing is sent on-chain and no gas is spent.
import { checksumAddress } from "./keccak";
import { carryOverLocalDetails } from "./auth-client";

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function provider(): Eip1193 | null {
  const w = window as unknown as { ethereum?: Eip1193 };
  return w.ethereum ?? null;
}

export const hasWallet = () => typeof window !== "undefined" && provider() !== null;

const nonce = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
};

const toHex = (s: string) => "0x" + [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The EIP-4361 message the wallet signs. Pure, so it can be tested. */
export function signInMessage(o: { domain: string; origin: string; address: string; chainId: number; nonce: string; issuedAt: string; statement: string }): string {
  return [
    `${o.domain} wants you to sign in with your Ethereum account:`,
    o.address,
    "",
    o.statement,
    "",
    `URI: ${o.origin}/`,
    "Version: 1",
    `Chain ID: ${o.chainId}`,
    `Nonce: ${o.nonce}`,
    `Issued At: ${o.issuedAt}`,
  ].join("\n");
}

const friendly = (err: unknown) => {
  const e = err as { code?: number; message?: string };
  if (e?.code === 4001) return "You cancelled the request in your wallet.";
  if (e?.code === -32002) return "Your wallet already has a request open. Check the wallet window.";
  return e?.message?.slice(0, 160) || "The wallet didn't respond. Try again.";
};

/** Connect, sign and start a session. With lens, the wallet must own or manage a Lens account. */
export async function signInWithWallet(opts: { lens?: boolean } = {}): Promise<{ ok: true } | { error: string }> {
  const eth = provider();
  if (!eth) return { error: "No wallet found. Install MetaMask or Rabby, or open this page in your wallet app's browser." };
  try {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.[0]) return { error: "No account selected in your wallet." };
    const address = checksumAddress(accounts[0]);
    const chainId = parseInt(String(await eth.request({ method: "eth_chainId" })), 16) || 1;
    const message = signInMessage({
      domain: window.location.host,
      origin: window.location.origin,
      address,
      chainId,
      nonce: nonce(),
      issuedAt: new Date().toISOString(),
      statement: opts.lens ? "Sign in to Backline with your Lens account." : "Sign in to Backline with your wallet.",
    });
    const signature = (await eth.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
    const res = await fetch("/api/auth/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, signature, lens: Boolean(opts.lens) }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { error: j.error ?? "Sign-in didn't work. Try again." };
    await carryOverLocalDetails();
    return { ok: true };
  } catch (err) {
    return { error: friendly(err) };
  }
}
