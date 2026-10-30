// Google sign-in through Backline's own address. With GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set,
// Google's screen says "continue to backline-…vercel.app" (or the app name, once Google verifies the
// brand) instead of the Supabase project's address; Supabase still issues the session, from Google's
// ID token. Without them, this hands over to Supabase's own Google sign-in, as before.
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n.slice(0, 300) : "/");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const next = safeNext(url.searchParams.get("next"));
  const cfg = supabaseConfig();
  if (!cfg) return Response.redirect(`${origin}/signin?error=${encodeURIComponent("Sign-in isn't set up yet.")}`, 302);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    const params = new URLSearchParams({ provider: "google", redirect_to: `${origin}/auth/callback` });
    return Response.redirect(`${cfg.url}/auth/v1/authorize?${params}`, 302);
  }
  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set("bl_g_state", JSON.stringify({ state, next }), { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
