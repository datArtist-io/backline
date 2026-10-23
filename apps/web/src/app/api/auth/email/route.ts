// Email sign-in: sends a one-tap link that brings the person back signed in.
import { z } from "zod";
import { EMAIL_RE } from "@backline/engine";
import { sendSignInLink, supabaseConfig } from "@/lib/supabase";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(5, 10 * 60_000);
const bodySchema = z.object({ email: z.string().trim().toLowerCase().max(254).regex(EMAIL_RE) });

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many links sent. Try again in a few minutes." }, { status: 429 });
  const cfg = supabaseConfig();
  if (!cfg) return Response.json({ error: "Email sign-in isn't set up yet." }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Check your email address." }, { status: 400 });
  const origin = new URL(req.url).origin;
  const ok = await sendSignInLink(cfg, parsed.data.email, `${origin}/auth/callback`).catch(() => false);
  // The same reply either way, so the form can't be used to probe which emails have accounts.
  if (!ok) console.warn("[auth] sign-in link failed to send");
  return Response.json({ sent: true });
}
