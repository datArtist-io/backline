// Refund a prepaid booking that couldn't go ahead (no place could take the call).
import { z } from "zod";
import { getSession } from "@/lib/session";
import { walletFor } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = z.object({ entryId: z.string().regex(/^[0-9a-f-]{36}$/i) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Unknown payment." }, { status: 400 });
  await walletFor(s).refund(p.data.entryId);
  return Response.json({ ok: true });
}
