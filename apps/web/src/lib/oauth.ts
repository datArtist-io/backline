// Google and Apple sign-in through Supabase Auth, without extra client libraries.
// The browser goes to Supabase's authorize URL; Supabase returns to /join with a short-lived
// access token in the URL fragment, which the server verifies before using the email.
export type Provider = "google" | "apple";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";

export const oauthEnabled = Boolean(SUPABASE_URL);

export function oauthUrl(provider: Provider, returnTo: string): string {
  const params = new URLSearchParams({ provider, redirect_to: returnTo });
  return `${SUPABASE_URL}/auth/v1/authorize?${params}`;
}

/** Read and clear tokens Supabase put in the URL fragment after sign-in. */
export function takeOauthToken(): { accessToken: string; provider: Provider | null } | null {
  if (typeof window === "undefined" || !window.location.hash.includes("access_token=")) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  // Remove the token from the address bar and history straight away.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!accessToken) return null;
  let provider: Provider | null = null;
  try {
    const stored = sessionStorage.getItem("backline.oauth");
    provider = stored === "google" || stored === "apple" ? stored : null;
    sessionStorage.removeItem("backline.oauth");
  } catch {
    /* ignore */
  }
  return { accessToken, provider };
}
