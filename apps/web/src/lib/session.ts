// The signed-in session, kept in two httpOnly cookies the page's scripts can't read: a short-lived
// access token and a refresh token. Refreshed on the server when the access token runs out.
import { cookies } from "next/headers";
import { refreshTokens, supabaseConfig, userFor, type AuthUser, type SupabaseConfig, type Tokens } from "./supabase";

const ACCESS = "bl_at";
const REFRESH = "bl_rt";
const EXPIRES = "bl_exp";
const secure = process.env.NODE_ENV === "production";

export type Session = { user: AuthUser; accessToken: string; cfg: SupabaseConfig };

export async function setSession(t: Tokens): Promise<void> {
  const jar = await cookies();
  const base = { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
  jar.set(ACCESS, t.accessToken, { ...base, maxAge: Math.max(60, Math.round((t.expiresAt - Date.now()) / 1000)) });
  jar.set(REFRESH, t.refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 });
  jar.set(EXPIRES, String(t.expiresAt), { ...base, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  for (const name of [ACCESS, REFRESH, EXPIRES]) jar.delete(name);
}

/** The current person, refreshing their tokens if needed, or null when signed out or sign-in isn't set up. */
export async function getSession(opts: { refresh?: boolean } = {}): Promise<Session | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const jar = await cookies();
  let accessToken = jar.get(ACCESS)?.value ?? null;
  const refreshToken = jar.get(REFRESH)?.value ?? null;
  const expiresAt = Number(jar.get(EXPIRES)?.value ?? 0);
  // Refresh with room to spare: a mission streams for up to five minutes on this token.
  // Pages (server components) can't save cookies, so they never rotate the refresh token (refresh: false).
  if (opts.refresh !== false && (!accessToken || expiresAt - Date.now() < 6 * 60_000) && refreshToken) {
    const fresh = await refreshTokens(cfg, refreshToken);
    if (fresh === "invalid") {
      await clearSession().catch(() => undefined);
      return null;
    }
    if (fresh === "unavailable") {
      // Supabase didn't answer: keep them signed in on the current token if it still works.
      if (!accessToken || expiresAt <= Date.now()) return null;
    } else {
      accessToken = fresh.accessToken;
      await setSession(fresh).catch(() => undefined);
    }
  }
  if (!accessToken) return null;
  const user = await userFor(cfg, accessToken);
  return user ? { user, accessToken, cfg } : null;
}
