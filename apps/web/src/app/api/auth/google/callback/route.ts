// Google sends the person back here: check the state, swap the code for Google's ID token, have
// Supabase sign them in with it, keep the session in httpOnly cookies, then finish on /auth/callback.
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/supabase";
import { setSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const fail = (msg: string) => Response.redirect(`${origin}/signin?error=${encodeURIComponent(msg)}`, 302);
  const jar = await cookies();
  const saved = jar.get("bl_g_state")?.value;
  jar.delete({ name: "bl_g_state", path: "/api/auth/google" });
  let expected: { state: string; next: string } | null = null;
  try {
    expected = saved ? (JSON.parse(saved) as { state: string; next: string }) : null;
  } catch {
    expected = null;
  }
  if (url.searchParams.get("error")) return fail("Google sign-in was cancelled.");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected.state) return fail("That sign-in expired. Try again.");
  const cfg = supabaseConfig();
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!cfg || !clientId || !secret) return fail("Sign-in isn't set up yet.");
  try {
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: secret, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(10000),
    });
    const g = (await tok.json().catch(() => ({}))) as { id_token?: string; error?: string };
    if (!tok.ok || !g.id_token) {
      console.warn("[auth/google] code exchange failed", tok.status, g.error ?? "");
      return fail("Google sign-in didn't finish. Try again.");
    }
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=id_token`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", id_token: g.id_token }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    const s = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; msg?: string; error_description?: string };
    if (!res.ok || !s.access_token || !s.refresh_token) {
      console.warn("[auth/google] supabase id_token sign-in failed", res.status, s.msg ?? s.error_description ?? "");
      return fail("Sign-in didn't finish. Try again.");
    }
    await setSession({ accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: Date.now() + (s.expires_in ?? 3600) * 1000 });
    return Response.redirect(`${origin}/auth/callback?signed=1&next=${encodeURIComponent(expected.next)}`, 302);
  } catch (err) {
    console.warn("[auth/google] failed", err instanceof Error ? err.message : err);
    return fail("Google didn't answer. Try again.");
  }
}
