# Security

## Reporting a vulnerability

Email the maintainer (see the GitHub profile) with steps to reproduce. Please don't open a public issue.

## What we protect

| Asset | Why it matters |
|---|---|
| API keys (Qloo, Nebius, Claude, Tavily, Supabase, Resend, Vapi) | Abuse costs money and can get keys revoked |
| What people tell the planner (requests, documents, preferences) | Plans can reveal where someone will be and when |
| Qloo data | Licensed for the hackathon; must not be published |
| Waitlist emails | Personal data |

## Threats and controls

| Threat | Control |
|---|---|
| **Leaked secrets** | Keys live only in the hosting provider's settings and the git-ignored `apps/web/.env.local`. Environment variables are validated at start-up. Keys are used only on the server and never sent to the browser. |
| **Prompt injection** (a web page, document or request tells the model what to do) | Web text, documents and the request are passed to the model as quoted data with a rule that they can't change instructions. The agent's tools are fixed and validated; it can't fetch arbitrary URLs. Outputs are parsed with Zod. |
| **Invented places, prices or contacts** | The agent can pick only ids its searches returned. Emails and phone numbers from the web are kept only if they appear in the cited page; hotel prices only if their page is among the search results. |
| **Actions the user didn't want** | Emails, calls and reservations run only after the user approves each one, within per-mission limits (4 emails, 3 calls, 1 reservation). Hotel payment goes through the booking provider's account payment method, only at the approved price and within the trip's budget; a higher price stops for approval. Card details never pass through Backline. Calls say they're from an AI assistant. |
| **Unsafe rendering of model text** | Generated text is rendered as text, never as HTML. Links are limited to `https:`. Exported documents escape all text. |
| **Abuse and cost** | Per-IP rate limits on every API route, size caps on uploads (documents, voice), timeouts on every outbound call. |
| **Server-side request forgery** | The server never fetches a URL the user supplies. Outbound calls go only to the services listed above and OpenStreetMap. |
| **Clickjacking and content sniffing** | Security headers on every page: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` (microphone for our own origin only), HSTS. |
| **Voice input** | The microphone opens only while the button is held. The clip goes to `/api/transcribe`, which forwards it to the speech-to-text provider and returns text. Audio isn't stored or logged. |
| **Spreadsheet formula injection** | CSV cells starting with `= + - @` are prefixed so spreadsheet apps treat them as text. |
| **Waitlist data** | Row-level security on with no public policies; only the server writes, through `waitlist_join()`. Honeypot field, minimum fill time and a rate limit. Duplicate emails get a generic reply. IP addresses aren't stored. |
| **Publishing Qloo data** | Qloo responses are cached in memory only. None are in the repo, fixtures or logs; tests use synthetic data. |

## Data handling

- Plans are built per request and aren't stored on the server. Preferences stay in the browser.
- Logs contain no keys, personal details or Qloo payloads.
- Waitlist entries hold an email, a referral code and a consent time.

## Release checklist

- [ ] No secrets in the diff
- [ ] New API routes validate input with Zod and are rate limited
- [ ] New outbound services added here deliberately
- [ ] Security headers present on the deployed site
