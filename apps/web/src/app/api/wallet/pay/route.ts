// Pays one approved booking from the signed-in person's wallet (used when a booking is picked back up,
// e.g. after adding a phone number). Held and captured in the database, with a receipt's details.
import { z } from "zod";
import { getSession } from "@/lib/session";
import { walletFor } from "@/lib/wallet";
import { bookingRef } from "@backline/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  amount: z.number().positive().max(50000),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  label: z.string().min(1).max(200),
  details: z.record(z.union([z.string().max(300), z.number(), z.null()])).optional(),
});

export async function POST(req: Request) {
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "That payment isn't complete." }, { status: 400 });
  const w = walletFor(s);
  const h = await w.hold(p.data.amount, p.data.currency, p.data.label, p.data.details ?? {});
  if (!h.ok) return Response.json({ error: h.reason }, { status: 402 });
  const ref = bookingRef(null, `${h.id}:${p.data.label}`);
  await w.capture(h.id, ref);
  return Response.json({ entryId: h.id, total: p.data.amount, currency: p.data.currency.toUpperCase(), ref });
}
