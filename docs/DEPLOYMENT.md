# Deployment

Backline runs on Vercel (project `backline`) with Supabase for accounts. Every push to `main` deploys to production; every other branch gets a preview.

## First deploy

1. **Supabase**: create a project, then run the SQL in `packages/db/migrations` in order (`0001` → `0006`) in the SQL editor. Set up Google and email sign-in as in [SETUP-AUTH.md](SETUP-AUTH.md).
2. **Vercel**: import the repository. Framework Next.js, Node.js 20.3 or newer; `npm run build` at the root builds the web app (`apps/web`).
3. **Environment variables**: add them in Vercel under Settings → Environment Variables, for Production (and Preview if you test there). The full list is in the [README](../README.md#environment-variables-appswebenvlocal). The minimum to plan a trip: `QLOO_API_KEY` and one AI model (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`).
4. **Deploy**, then open `/api/health` signed in as an `ADMIN_EMAILS` account to see which services answer (set `HEALTH_TOKEN` in Vercel and as a GitHub secret for the synthetic monitor).

## Changing a key

Vercel reads environment variables at build time for `NEXT_PUBLIC_*` and at start for the rest, so after any change: Deployments → the latest → ⋯ → **Redeploy**.

## Checks before a release

```bash
npm run typecheck
npm test
npm run check          # live: Qloo and the AI model answer
```

GitHub Actions runs the type check and tests on every push and pull request (`.github/workflows/ci.yml`).

## Safety switches

| Variable | Off (default) | On |
|---|---|---|
| `BOOKING_LIVE` | Live Duffel and LiteAPI keys only price; checkout is a demo | `1`: real tickets and rooms are bought |
| `CALLS_LIVE` | Calls ring only the signed-in person's own phone | `1`: calls reach real businesses |

Leave both off for demos.

## Rolling back

Vercel → Deployments → pick the last good one → ⋯ → **Promote to Production**. Database migrations only add tables and columns, so an older build runs against a newer database.
