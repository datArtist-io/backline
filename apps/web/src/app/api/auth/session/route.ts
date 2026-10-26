// Sign-in sessions. POST takes the tokens Supabase returned after Google or an email link,
// verifies them and stores them in httpOnly cookies. GET says who's signed in. DELETE signs out.
import { z } from "zod";
import { clearSession, getSession, setSession } from "@/lib/session";
import { enabledProviders, signOutEverywhere, supabaseConfig, userFor } from "@/lib/supabase";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(20);
const bodySchema = z.object({ accessToken: z.string().min(20).max(4000), refreshToken: z.string().min(6).max(400), expiresIn: z.number().int().min(60).max(86400).optional() });

export async function GET() {
  const cfg = supabaseConfig();
  const [s, providers] = await Promise.all([getSession(), cfg ? enabledProviders(cfg) : null]);
  return Response.json({ configured: Boolean(cfg), user: s?.user ?? null, providers });
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many attempts. Wait a minute." }, { status: 429 });
  const cfg = supabaseConfig();
  if (!cfg) return Response.json({ error: "Sign-in isn't set up yet." }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "That sign-in link didn't work. Try again." }, { status: 400 });
  const user = await userFor(cfg, parsed.data.accessToken);
  if (!user) return Response.json({ error: "That sign-in has expired. Try again." }, { status: 401 });
  await setSession({ accessToken: parsed.data.accessToken, refreshToken: parsed.data.refreshToken, expiresAt: Date.now() + (parsed.data.expiresIn ?? 3600) * 1000 });
  return Response.json({ user });
}

export async function DELETE() {
  const s = await getSession();
  if (s) await signOutEverywhere(s.cfg, s.accessToken);
  await clearSession();
  return Response.json({ ok: true });
}
