// Email sign-in with a code: the sign-in email carries a 6-digit code as well as the link, so people
// can sign in on any device (or when the link opens in another browser). Limited per address and
// per connection so codes can't be guessed.
import { z } from "zod";
import { EMAIL_RE } from "@backline/engine";
import { supabaseConfig, userFor, verifyEmailCode } from "@/lib/supabase";
import { setSession } from "@/lib/session";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const perIp = rateLimiter(10, 10 * 60_000);
const perEmail = rateLimiter(5, 10 * 60_000);
const bodySchema = z.object({
  email: z.string().trim().toLowerCase().max(254).regex(EMAIL_RE),
  code: z.string().trim().regex(/^\d{6,10}$/),
});

export async function POST(req: Request) {
  if (perIp(clientIp(req))) return Response.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  const cfg = supabaseConfig();
  if (!cfg) return Response.json({ error: "Email sign-in isn't set up yet." }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter the code from the email." }, { status: 400 });
  if (perEmail(`code:${parsed.data.email}`)) return Response.json({ error: "Too many tries for this email. Ask for a new code in a few minutes." }, { status: 429 });
  const tokens = await verifyEmailCode(cfg, parsed.data.email, parsed.data.code);
  if (!tokens) return Response.json({ error: "That code is wrong or has expired. Check it, or send a new one." }, { status: 401 });
  const user = await userFor(cfg, tokens.accessToken);
  if (!user) return Response.json({ error: "That sign-in didn't work. Try again." }, { status: 401 });
  await setSession(tokens);
  return Response.json({ user });
}
