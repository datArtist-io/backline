# Runbook

What to check and do when something goes wrong, and before a live demo.

## Before a live demo (30–60 minutes ahead)

1. Open `/api/health`: every AI model, Qloo and research should answer. Top up any provider that returns 402.
2. Top up the demo wallet (Account → Wallet) so it covers the whole trip you'll show.
3. Check your phone is on your account (Account → Details → Phone) for the demo call.
4. Run the trip you'll present once, end to end, on the machine and network you'll use.
5. Open the trip and leave the tab open: the 3D city loads ahead in the background. Don't reload it.
6. Run one trip at a time. Free model tiers rate-limit two at once.

## Symptoms

| What you see | Likely cause | What to do |
|---|---|---|
| "Run on autopilot" or "The model led; the autopilot finished" under How the agent worked | The AI model failed or ran out of credit | `/api/health`; top up or switch `LLM_*` to a working provider; redeploy |
| "No live fare for your dates" on every trip | `SERPAPI_API_KEY` missing, or the month's searches used up | Add or renew the key; redeploy |
| Restaurants or hotels missing | Qloo slow or OpenStreetMap mirrors down | Run again; check `/api/health` |
| Satellite instead of real 3D buildings | Google Map Tiles key missing, restricted to another site, or billing off | Check the key's website restriction and the billing account in Google Cloud |
| Routes as straight lines | Both routing servers failed for that day | Run again; it's per day |
| "Your wallet is short" | Demo balance below the trip total | Add demo funds, or untick something |
| Demo call doesn't ring | No phone on the account, daily cap reached, or Vapi down | Add the phone; `DEMO_CALLS_PER_DAY`; check Vapi's dashboard |
| Sign-in loops back | Supabase redirect URL doesn't include this site | Supabase → Auth → URL configuration |

## Where to look

- `/ops` (accounts in `ADMIN_EMAILS`): recent missions, model calls with timings and errors, usage.
- Vercel → the deployment → Logs: server errors, with `[engine]` and `[mission]` prefixes.
- The trace under "How the agent worked" on any trip: every decision, tool call, result and self-check.

## Incidents

1. Turn off what's at risk: unset `CALLS_LIVE` / `BOOKING_LIVE`, or roll back (see [DEPLOYMENT.md](DEPLOYMENT.md)).
2. Rotate any key that may have leaked, in the provider and in Vercel, then redeploy.
3. If personal data may have been exposed, note what, whose and when, and tell the people affected and the data protection authority within 72 hours.
4. Write down what happened and the fix in [VERIFICATION.md](VERIFICATION.md).
