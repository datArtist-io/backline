# API reference

Every route lives in `apps/web/src/app/api`. All are rate limited per IP, validate input with Zod, and refuse cross-site `POST`, `PUT`, `PATCH` and `DELETE` (the request's `Origin` must be this site). "Signed in" means a valid session cookie; the route reads and writes only that person's rows (Supabase row-level security).

## Planning

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/api/mission` | POST | Optional | Runs a mission and streams the agent's work as Server-Sent Events: `step.started`, `step.progress` (the agent's thoughts and tool calls), `step.succeeded`, `step.failed`, `step.skipped`, `step.waiting` (a checkpoint needs approval). Body: `{ goal, mode, ... }`. Booking needs a signed-in person when sign-in is on |
| `/api/mission/ask` | POST | Optional | Follow-up question on a mission just run; answers only from that run's results |
| `/api/mission/week` | POST | Optional | Writes one more week of a long trip |
| `/api/documents` | POST | Optional | Reads an attached file (Word, PowerPoint, Excel, text, web page) into text for the agent |
| `/api/transcribe` | POST | Optional | Speech-to-text for the voice prompt; audio isn't stored |
| `/api/profile/import` | POST | Optional | Turns pasted notes from another assistant into preferences |
| `/api/fx` | GET | None | Exchange rates (units per US dollar) |
| `/api/site-check` | GET | None | Whether a booking website is live (public hosts only; returns a verdict, never the page) |

## Account

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/api/account` | GET, PUT | Signed in | Details, memories and trips; save details |
| `/api/account/trips` | DELETE | Signed in | Delete a saved trip (bookings stay with the provider) |
| `/api/account/searches` | GET, DELETE | Signed in | Search history; forget one (`?id=`) or all (`?all=1`) |
| `/api/account/memories` | DELETE | Signed in | Forget one thing the agent remembered |
| `/api/account/documents` | GET, PUT, DELETE | Signed in | Passport: masked summary only (GET), save with consent (PUT), remove (DELETE) |
| `/api/kyc` | GET, POST | Signed in | Identity check status; record a finished Persona inquiry (verified on the server) |
| `/api/calendar` | POST | Signed in | The person's private calendar subscription link |
| `/api/calendar/feed/[file]` | GET | Signed link | The `.ics` feed a calendar app polls (HMAC-signed, unguessable) |
| `/api/share/email` | POST | Signed in | Emails the plan to the person's own address only |

## Sign-in

| Route | Method | What it does |
|---|---|---|
| `/api/auth/google`, `/api/auth/google/callback` | GET | Google sign-in on Backline's own address (state-checked) |
| `/api/auth/email` | POST | Sends a one-tap sign-in link |
| `/api/auth/session` | GET, POST, DELETE | Read, set (from Supabase tokens) or end the session; cookies are `httpOnly`, `Secure`, `SameSite=Lax` |

## Wallet (demo balance; no real money)

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/api/wallet` | GET, POST | Signed in | Balance and ledger; add demo funds (capped) |
| `/api/wallet/pay` | POST | Signed in | Pay one approved booking |
| `/api/wallet/refund` | POST | Signed in | Refund a prepaid booking that couldn't go ahead (call prepayments, last day only) |
| `/api/wallet/receipts/[id]` | GET | Signed in | One receipt |

## Calls

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/api/calls` | POST | Signed in | Places a booking call for the next place when one didn't connect |
| `/api/calls/[id]` | GET, POST | Caller only | Call status and outcome; retry |
| `/api/calls/line` | GET | Signed in | The calling line's configuration, for diagnosing |
| `/api/demo-call` | POST, GET | Signed in | "Call me now": rings the person's own number (daily cap) |
| `/api/briefing-call` | POST, GET | Signed in | Rings the traveller with a briefing once the trip is booked |
| `/api/call-trips` | GET | None | The Backline phone number and trips planned by calling it (code and trip only) |
| `/api/vapi/inbound` | POST | Webhook secret | Vapi's server URL for the inbound number (`x-vapi-secret` checked) |
| `/api/vapi/assistant` | — | — | Assistant definition for browser calls |

## Operations

| Route | Method | Auth | What it does |
|---|---|---|---|
| `/api/health` | GET | None for `{ ok, core, at }`; `HEALTH_TOKEN` bearer or `ADMIN_EMAILS` for the per-service list | Whether outside services answer right now; the private view adds each service with timings |
| `/api/ops` | GET | `ADMIN_EMAILS` | Private monitoring feed for `/ops`; others get a 404 |

## Errors

Errors return JSON `{ "error": "<plain sentence for the person>" }` with a matching status: `400` bad input, `401` sign in needed, `403` not yours or cross-site, `404` not found, `429` rate limited, `502` an outside service failed.
