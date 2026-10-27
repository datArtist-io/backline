// The signed-in person's identity check (Persona): status (GET), and recording a finished inquiry (POST).
import { z } from "zod";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { kycFor, recordInquiry } from "@/lib/kyc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(20);

export async function GET() {
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const state = await kycFor(s).catch(() => null);
  if (!state) return Response.json({ error: "Couldn't check your verification." }, { status: 502 });
  return Response.json({ ...state, referenceId: s.user.id }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many tries. Wait a moment." }, { status: 429 });
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const parsed = z.object({ inquiryId: z.string().regex(/^inq_[A-Za-z0-9]{6,64}$/) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That verification id isn't valid." }, { status: 400 });
  try {
    return Response.json(await recordInquiry(s, parsed.data.inquiryId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[kyc] record failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "That verification couldn't be saved." }, { status: 400 });
  }
}
