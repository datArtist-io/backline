# Setting up Google and Apple sign-in

The waitlist offers **Continue with Google**, **Continue with Apple** and email. Sign-in runs through Supabase Auth; the app needs no extra libraries.

## How it works

1. The button sends the browser to `SUPABASE_URL/auth/v1/authorize?provider=google|apple`.
2. Supabase returns to `/join` with a short-lived access token in the URL fragment. The page removes it from the address bar immediately.
3. The page asks one question (what you do) and posts the token to `/api/waitlist`.
4. The server verifies the token with Supabase (`/auth/v1/user`) and takes the email **from Supabase, never from the browser**, then adds the person to the waitlist with `source = google | apple`.

## Steps

1. Create a Supabase project and run `packages/db/migrations/0001_waitlist.sql`, then `0002_waitlist_roles.sql`, in its SQL editor.
2. In `apps/web/.env.local` set `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SUPABASE_URL` (the same project URL).
3. Supabase → Authentication → URL Configuration: set **Site URL** to `https://backline-beta-one.vercel.app` and add `http://localhost:3000/join` and `https://backline-beta-one.vercel.app/join` to **Redirect URLs**.
4. Add the same three variables in Vercel → Project → Settings → Environment Variables, then redeploy.
5. **Google:** in Google Cloud Console create an OAuth client (Web). Authorised redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`. Paste the client ID and secret into Supabase → Authentication → Providers → Google.
6. **Apple:** needs an Apple Developer account. Create a Services ID with Sign in with Apple, return URL `https://<project-ref>.supabase.co/auth/v1/callback`, and a key. Paste the Services ID, Team ID, Key ID and key into Supabase → Providers → Apple.

Until a provider is set up, its button explains that it isn't switched on and points to email.
