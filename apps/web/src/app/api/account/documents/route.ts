// Travel documents. GET returns a masked summary only; PUT saves a passport (with consent);
// DELETE removes it. The full passport never leaves the server.
import { z } from "zod";
import type { PassportDetails } from "@backline/engine";
import { getSession } from "@/lib/session";
import { deletePassport, passportSchema, passportSummary, savePassport } from "@/lib/documents";
import { vaultReady } from "@/lib/vault";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(10);
const putSchema = z.object({ passport: passportSchema, consent: z.literal(true, { errorMap: () => ({ message: "Tick the box to agree before saving." }) }) });

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    return Response.json({ ready: vaultReady(), passport: await passportSummary(s) });
  } catch (err) {
    console.error("[documents] load failed", err instanceof Error ? err.message : err);
    return Response.json({ ready: vaultReady(), passport: null });
  }
}

export async function PUT(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!vaultReady()) return Response.json({ error: "Secure document storage isn't switched on yet." }, { status: 503 });
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
  try {
    return Response.json({ passport: await savePassport(s, parsed.data.passport as PassportDetails) });
  } catch (err) {
    // Never log the document itself.
    console.error("[documents] save failed", err instanceof Error ? err.message.slice(0, 200) : "unknown");
    return Response.json({ error: "Your passport couldn't be saved. Try again." }, { status: 502 });
  }
}

export async function DELETE() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  // Say so when it didn't work, so nothing looks deleted that isn't (a passport above all).
  try {
    await deletePassport(s);
  } catch (err) {
    console.error("[documents] delete failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Your passport couldn't be deleted. Try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
