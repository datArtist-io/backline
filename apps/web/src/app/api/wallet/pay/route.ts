// Pays one approved booking from the signed-in person's wallet (used when a booking is picked back up,
// e.g. after adding a phone number). Held and captured in the database, with a receipt's details.
import { z } from "zod";
import { getSession } from "@/lib/session";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { walletFor } from "@/lib/wallet";
import { bookingRef } from "@backline/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  // In the person's own currency (₦, ¥…), so no small USD-style cap; the wallet checks the balance.
  amount: z.number().positive().max(1e10),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  label: z.string().min(1).max(200),
  details: z.record(z.union([z.string().max(300), z.number(), z.null()])).optional(),
});

const rateLimited = rateLimiter(20);

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many tries. Wait a moment." }, { status: 429 });
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "That payment isn't complete." }, { status: 400 });
  const w = walletFor(s);
  let h: Awaited<ReturnType<typeof w.hold>>;
  try {
    h = await w.hold(p.data.amount, p.data.currency, p.data.label, p.data.details ?? {});
  } catch (err) {
    console.warn("[wallet/pay] hold failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Your wallet couldn't be reached. Nothing was charged. Try again." }, { status: 502 });
  }
  if (!h.ok) return Response.json({ error: h.reason }, { status: 402 });
  const ref = bookingRef(null, `${h.id}:${p.data.label}`);
  try {
    await w.capture(h.id, ref);
  } catch (err) {
    // Don't leave the money held forever: give it back and say so.
    console.warn("[wallet/pay] capture failed", err instanceof Error ? err.message : err);
    await w.release(h.id).catch(() => undefined);
    return Response.json({ error: "The payment didn't complete, so your money was returned. Try again." }, { status: 502 });
  }
  return Response.json({ entryId: h.id, total: p.data.amount, currency: p.data.currency.toUpperCase(), ref });
}
