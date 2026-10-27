// Refund a prepaid booking that couldn't go ahead (no place could take the call).
import { z } from "zod";
import { getSession } from "@/lib/session";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { walletFor, type WalletEntry } from "@/lib/wallet";
import { rest } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(20);

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many tries. Wait a moment." }, { status: 429 });
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = z.object({ entryId: z.string().regex(/^[0-9a-f-]{36}$/i) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Unknown payment." }, { status: 400 });
  // Only a prepaid call booking from the last day can come back; provider bookings are cancelled with the provider.
  const rows = await rest<Pick<WalletEntry, "id" | "status" | "details" | "created_at">[]>(s.cfg, s.accessToken, `wallet_entries?select=id,status,details,created_at&id=eq.${p.data.entryId}&kind=eq.payment`).catch(() => []);
  const e = rows[0];
  if (!e) return Response.json({ error: "Payment not found." }, { status: 404 });
  if (e.status === "void") return Response.json({ ok: true });
  if (typeof e.details?.title !== "string" || Date.now() - Date.parse(e.created_at) > 86_400_000)
    return Response.json({ error: "This payment can't be refunded here." }, { status: 409 });
  await walletFor(s).refund(p.data.entryId);
  return Response.json({ ok: true });
}
