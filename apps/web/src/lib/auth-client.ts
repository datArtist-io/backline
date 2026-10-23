"use client";
// Signing in from the browser: Google and Apple through Supabase's sign-in page, or a one-tap
// email link. Either way Supabase sends the person back to /auth/callback with tokens in the URL
// fragment, which go straight to our server to become httpOnly cookies, then leave the address bar.
import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@backline/engine";
import { loadProfile, saveProfile } from "./profile";

export type Provider = "google" | "apple";
export type Me = { id: string; email: string | null; name: string | null; avatar: string | null; provider: string | null };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") ?? "";
export const signInAvailable = Boolean(SUPABASE_URL);
const NEXT_KEY = "backline.next";

const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

export function startOAuth(provider: Provider, next?: string) {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNext(next));
  } catch {
    /* ignore */
  }
  const params = new URLSearchParams({ provider, redirect_to: `${window.location.origin}/auth/callback` });
  window.location.href = `${SUPABASE_URL}/auth/v1/authorize?${params}`;
}

export async function sendEmailLink(email: string, next?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNext(next));
  } catch {
    /* ignore */
  }
  const res = await fetch("/api/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? { ok: true } : { ok: false, error: j.error ?? "That didn't work. Try again." };
}

/** Finish signing in on /auth/callback. Returns where to go next, or an error to show. */
export async function completeSignIn(): Promise<{ next: string } | { error: string }> {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  // Clear the tokens from the address bar and history straight away.
  window.history.replaceState(null, "", window.location.pathname);
  const failure = hash.get("error_description") ?? query.get("error_description");
  if (failure) return { error: failure.replace(/\+/g, " ") };
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!accessToken || !refreshToken) return { error: "That sign-in link has expired. Try again." };
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, refreshToken, expiresIn: Number(hash.get("expires_in") ?? 3600) }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { error: j.error ?? "Sign-in didn't work. Try again." };
  await carryOverLocalDetails();
  let next = "/";
  try {
    next = safeNext(sessionStorage.getItem(NEXT_KEY));
    sessionStorage.removeItem(NEXT_KEY);
  } catch {
    /* ignore */
  }
  return { next };
}

/** Details entered before signing in move into the new account, unless it already has some. */
async function carryOverLocalDetails() {
  const local = loadProfile();
  if (Object.keys(local).length === 0) return;
  const acc = await fetch("/api/account").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const saved = (acc as { profile?: Profile } | null)?.profile ?? {};
  if (Object.keys(saved).length > 0) return;
  await fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: local }) }).catch(() => undefined);
}

export async function signOut() {
  await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
  saveProfile({});
}

/** Who's signed in, if anyone. */
export function useMe(): { me: Me | null; ready: boolean; configured: boolean; refresh: () => void } {
  const [state, setState] = useState<{ me: Me | null; ready: boolean; configured: boolean }>({ me: null, ready: false, configured: signInAvailable });
  const refresh = useCallback(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { user: Me | null; configured: boolean }) => setState({ me: j.user, ready: true, configured: j.configured }))
      .catch(() => setState((s) => ({ ...s, ready: true })));
  }, []);
  useEffect(refresh, [refresh]);
  return { ...state, refresh };
}

/** Details from the account when signed in, else from this browser. */
export async function loadDetails(signedIn: boolean): Promise<Profile> {
  if (!signedIn) return loadProfile();
  const acc = await fetch("/api/account", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const p = (acc as { profile?: Profile } | null)?.profile;
  if (p) saveProfile(p);
  return p ?? loadProfile();
}

/** Save details to the account when signed in, and to this browser either way. */
export async function saveDetails(p: Profile, signedIn: boolean): Promise<boolean> {
  saveProfile(p);
  if (!signedIn) return true;
  const res = await fetch("/api/account", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: p }) }).catch(() => null);
  return Boolean(res?.ok);
}
