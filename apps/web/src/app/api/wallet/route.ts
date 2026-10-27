// The signed-in person's Backline Wallet (test funds): balance and ledger (GET), add test funds (POST).
import { z } from "zod";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { loadWallet, topUp } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(20);

export async function GET() {
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in to see your wallet." }, { status: 401 });
  try {
    return Response.json(await loadWallet(s), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[wallet] load failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Your wallet couldn't load. Try again." }, { status: 502 });
  }
}

const body = z.object({ dollars: z.number().int().min(1).max(1000) });

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many tries. Wait a moment." }, { status: 429 });
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in to add funds." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose an amount from $1 to $1,000." }, { status: 400 });
  try {
    await topUp(s, parsed.data.dollars * 100);
    return Response.json(await loadWallet(s), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    console.error("[wallet] top-up failed", msg);
    return Response.json({ error: /daily/.test(msg) ? "That's today's test top-up limit ($2,000)." : "Couldn't add funds just now." }, { status: /daily/.test(msg) ? 429 : 502 });
  }
}
