// Server-side check of a Supabase access token: returns the verified email and name, or null.
export async function verifiedIdentity(accessToken: string): Promise<{ email: string; name: string | null; provider: string | null } | null> {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(accessToken)) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { email?: string; email_confirmed_at?: string | null; app_metadata?: { provider?: string }; user_metadata?: { full_name?: string; name?: string } };
    if (!u.email) return null;
    return { email: u.email.toLowerCase(), name: u.user_metadata?.full_name || u.user_metadata?.name || null, provider: u.app_metadata?.provider ?? null };
  } catch {
    return null;
  }
}
