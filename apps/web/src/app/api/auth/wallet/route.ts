// Sign in with an Ethereum wallet, or with a Lens account (the wallet that owns or manages it).
// The browser sends the signed EIP-4361 message; Supabase verifies it and starts a session,
// which is kept in httpOnly cookies like every other sign-in.
import { z } from "zod";
import { setSession } from "@/lib/session";
import { supabaseConfig, updateUserMetadata, userFor, web3Tokens } from "@/lib/supabase";
import { lensAccountsFor } from "@/lib/lens";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(10);
const bodySchema = z.object({
  message: z.string().min(64).max(4000),
  signature: z.string().regex(/^(0x)?[0-9a-fA-F]{130}$/),
  lens: z.boolean().optional(),
  lensAccount: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

/** The wallet address line of a sign-in message. */
const walletIn = (message: string) => message.split("\n")[1]?.trim().match(/^0x[0-9a-fA-F]{40}$/)?.[0] ?? null;

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const cfg = supabaseConfig();
  if (!cfg) return Response.json({ error: "Sign-in isn't set up yet." }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "That signature didn't come through. Try again." }, { status: 400 });
  const { message, signature, lens, lensAccount } = parsed.data;
  const wallet = walletIn(message);
  if (!wallet) return Response.json({ error: "That sign-in message isn't valid." }, { status: 400 });

  // For Lens, find the account before starting a session, so a wallet without one isn't signed in.
  let account = null;
  if (lens) {
    try {
      const accounts = await lensAccountsFor(wallet);
      account = (lensAccount ? accounts.find((a) => a.address.toLowerCase() === lensAccount.toLowerCase()) : null) ?? accounts[0] ?? null;
    } catch (err) {
      console.error("[auth/wallet] lens lookup failed", err instanceof Error ? err.message : err);
      return Response.json({ error: "Lens didn't answer. Try again in a moment." }, { status: 502 });
    }
    if (!account) return Response.json({ error: "This wallet has no Lens account. Use “Continue with wallet” instead, or switch to the wallet that owns your Lens account." }, { status: 404 });
  }

  const tokens = await web3Tokens(cfg, message, signature);
  if ("error" in tokens) return Response.json({ error: tokens.error }, { status: 401 });

  await updateUserMetadata(cfg, tokens.accessToken, {
    wallet_address: wallet,
    ...(account ? { lens_handle: account.handle, lens_account: account.address, name: account.name ?? account.handle, avatar_url: account.picture } : {}),
  });
  const user = await userFor(cfg, tokens.accessToken);
  if (!user) return Response.json({ error: "Sign-in didn't finish. Try again." }, { status: 401 });
  await setSession(tokens);
  return Response.json({ user });
}
