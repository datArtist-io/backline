// Server-only access to Supabase over its REST APIs (no client library): Auth for sign-in and
// sessions, PostgREST for each person's own rows. Calls use the person's access token, so
// row-level security decides what they can read and write.

export type SupabaseConfig = { url: string; anonKey: string };

export function supabaseConfig(): SupabaseConfig | null {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export type AuthUser = { id: string; email: string | null; name: string | null; avatar: string | null; provider: string | null };
export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export type Providers = { google: boolean; email: boolean };

/** Which sign-in methods are switched on in the Supabase project. */
export async function enabledProviders(cfg: SupabaseConfig): Promise<Providers> {
  try {
    const res = await fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.anonKey }, signal: AbortSignal.timeout(5000), next: { revalidate: 60 } });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { external?: Record<string, boolean> };
    return { google: Boolean(j.external?.google), email: j.external?.email !== false };
  } catch {
    return { google: false, email: true };
  }
}

/** The user behind an access token, verified by Supabase, or null. */
export async function userFor(cfg: SupabaseConfig, accessToken: string): Promise<AuthUser | null> {
  if (!JWT.test(accessToken)) return null;
  try {
    const res = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: string; email?: string; app_metadata?: { provider?: string }; user_metadata?: { full_name?: string; name?: string; avatar_url?: string; picture?: string } };
    if (!u.id) return null;
    return {
      id: u.id,
      email: u.email?.toLowerCase() ?? null,
      name: u.user_metadata?.full_name || u.user_metadata?.name || null,
      avatar: u.user_metadata?.avatar_url || u.user_metadata?.picture || null,
      provider: u.app_metadata?.provider ?? null,
    };
  } catch {
    return null;
  }
}

/** New tokens from a refresh token; "invalid" when it's expired or revoked, "unavailable" when Supabase didn't answer. */
export async function refreshTokens(cfg: SupabaseConfig, refreshToken: string): Promise<Tokens | "invalid" | "unavailable"> {
  try {
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    // Only a definite refusal signs someone out; a timeout, rate limit or outage must not.
    if (res.status === 400 || res.status === 401 || res.status === 403) return "invalid";
    if (!res.ok) return "unavailable";
    const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!j.access_token || !j.refresh_token) return "invalid";
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  } catch {
    return "unavailable";
  }
}

/** Email a one-tap sign-in link that comes back to redirectTo. */
export async function sendSignInLink(cfg: SupabaseConfig, email: string, redirectTo: string): Promise<boolean> {
  const res = await fetch(`${cfg.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: true }),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  return res.ok;
}

/** Ends the session on Supabase's side too. */
export async function signOutEverywhere(cfg: SupabaseConfig, accessToken: string): Promise<void> {
  await fetch(`${cfg.url}/auth/v1/logout`, { method: "POST", headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
}

/** A PostgREST call as the signed-in person. */
export async function rest<T>(cfg: SupabaseConfig, accessToken: string, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
