# Setting up accounts: Google and email sign-in

Backline accounts run on Supabase: Supabase Auth for sign-in, and Postgres tables with row-level security for each person's details, trips and memory. The app talks to Supabase over its REST APIs and needs no extra libraries.

## How it works

1. **Sign in** at `/signin`. Google goes through `SUPABASE_URL/auth/v1/authorize?provider=google`; email sends a one-tap link through `/auth/v1/otp`.
2. Supabase returns to `/auth/callback` with tokens in the URL fragment. The page removes them from the address bar immediately and posts them to `/api/auth/session`.
3. The server verifies the token with Supabase (`/auth/v1/user`) and keeps the session in `httpOnly` cookies, refreshing it when it expires.
4. `/api/account` reads and saves the person's details; `/api/mission` loads their details and memories before a trip and saves the trip and what it learned afterwards. Every call uses the person's own token, so row-level security decides what it can touch.

## Steps

1. **Create a Supabase project.** In its SQL editor run `packages/db/migrations/0003_accounts.sql`, then `0004_searches.sql`, `0005_travel_documents.sql` and `0006_wallet.sql` (wallet ledger, its functions and identity checks; safe to run again). (0001 and 0002 are an earlier waitlist and are optional.)
2. **Keys.** Supabase → Project Settings → API. In `apps/web/.env.local` set:
   - `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`: the project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the `anon` / publishable key (safe in the browser)
   - `TRAVEL_DOCS_KEY`: 32 random bytes for encrypting passports. Make one with `openssl rand -base64 32`. Keep it secret and never change it, or saved passports can no longer be read.
3. **URLs.** Supabase → Authentication → URL Configuration:
   - **Site URL:** `https://backline-beta-one.vercel.app`
   - **Redirect URLs:** `https://backline-beta-one.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`
4. **Email.** Authentication → Providers → Email is on by default. The built-in sender is rate limited (a few emails an hour); for real use add custom SMTP (for example Resend) under Authentication → Emails → SMTP settings.
5. **Google.** Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application). Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Paste the client ID and secret into Supabase → Authentication → Providers → Google and enable it.
6. **Vercel.** Add the same four variables in Vercel → Project → Settings → Environment Variables, then redeploy. `NEXT_PUBLIC_` values are baked in at build time, so a redeploy is needed after changing them.

## Checking it

- `/api/auth/session` returns `{"configured": true, "user": null}` when signed out.
- Sign in at `/signin`; the top-right button changes to **Account**.
- Save details at `/account`, then run a trip: when it finishes, it appears under **Your trips**, and its tastes and city appear under **Your preferences**.

The sign-in page asks Supabase which providers are switched on and only shows those, so Google shows a short note until it is enabled; email works as soon as the project exists.
