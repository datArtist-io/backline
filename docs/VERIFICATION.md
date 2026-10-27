# Verification Log

Live Missions run against production (`backline-beta-one.vercel.app`), what was checked, what was wrong, and the fix. Each finding cites the commit that resolved it. Facts were checked against an independent source, never against the system's own output.

## Method

1. Run a real Mission from the live site in **Check with me** mode (nothing is executed without approval).
2. Read the finished model straight from the running page (places, coordinates, plan, routes, travel, weather).
3. Check each fact against an independent source: OpenStreetMap Nominatim for coordinates and addresses, Open-Meteo for weather, the calendar for dates, the venue's own nature for plan items.
4. Record the finding; fix at the root; add an automated test where the rule is mechanical; re-run.

## Results

| # | Mission | Check | Independent source | Result | Fix |
|---|---|---|---|---|---|
| V1 | Lisbon weekend for 2 from London | Coordinates of all 5 picks (Solar dos Presuntos, Adega Machado, Sheraton Lisboa, CINCO Lounge, Lisbon Airport) | Nominatim | Correct, within metres of the street address | — |
| V2 | same | Weather 31 Oct: high 27°, cloudy | Open-Meteo forecast: 26.6°, code 3 | Correct | — |
| V3 | same | Sunset 17:37 | Astronomical tables for Lisbon after the 25 Oct clock change | Correct | — |
| V4 | same | "100% taste match" on two places | Qloo affinity values 0.974–0.996 | **Overstated** (rank shown as a percentage) | Show Qloo affinity (3 dp) and rank within kind — `ba076e9` |
| V5 | same | Hotel prices | — | None shown: sandbox rates were correctly withheld | Test-mode rates now labelled, never shown as prices — `c237ec3` |
| V6 | same | "Getting there" London→Lisbon | — | **Thin** (no duration or fare) | Route-planner, fare and journey-time searches — `ba076e9` |
| V7 | same | "A weekend" resolved to 1–2 Nov (Sun–Mon) | Calendar: Sat 31 Oct – Sun 1 Nov | **Wrong** | Deterministic weekend resolution + tests — `ba076e9` |
| V8 | Long weekend in Tokyo for 2 from New York | Dates | Calendar | 30 Oct – 2 Nov (Fri–Mon): correct after V7 | — |
| V9 | same | Weather 30 Oct – 2 Nov | Open-Meteo | Consistent (drizzle, clear, cloudy, cloudy) | — |
| V10 | same | Coordinates of 6 picks (Kioicho, Nihonbashi, Roppongi, Dogenzaka, Hiroo, Udagawacho) | Addresses in Japanese and English | Consistent | — |
| V11 | Weekend in Rome for 2, opera and pasta | Hotel Quirinale (Via Nazionale 7), Teatro dell'Opera, Giolitti | Nominatim | Correct | — |
| V12 | same | "Dinner at Giolitti", "pasta lunch at Giolitti" | Giolitti is a gelateria | **Wrong kind of meal** | Places described to the planner with their kinds; rule against mismatched meals and repeat visits — `43ed414` |
| V13 | same | "Lunch at Cafe Washington Cafe Washington" | — | **Doubled name** (id after name) | `nameRefs` drops an id that follows its own name; test — `43ed414` |
| V14 | same | "Opera performance at 20:00" stated as fact | No schedule source | **Unconfirmed** | Rule: never state an event is on unless notes confirm; say "See what's on" — `43ed414` |
| V15 | Rome (re-run after V12–V14) | Meals, names, departure time | — | Fixed: no gelato dinners, no doubled names, departure time left to the traveller | — |
| V16 | Map | 3D beacons vs pins at street zoom, 10 km from centre | Pixel comparison | **~15 px drift** (single local frame) | Mercator-exact local frame, re-anchored under the camera — `2f6bb16` |
| V17 | Map | Pin positions | Pixel comparison vs route vertices | **Wrong** (marker classes overwritten) | Keep MapLibre's own marker classes — `2f6bb16` |
| V18 | Trip to Dubai (no origin, no dates) | Getting there, weather | — | **Empty** | Origin from home city or connection; coming long weekend when no dates; both stated as assumptions — `4bbe840` |
| V19 | same | "Your taste" | — | **Empty** (no likes given) | Destination read through Qloo ("What people who love Dubai go for"), stated as an assumption; test — this release |
| V20 | Dinner for 2 in Lagos "this Friday at 8pm", signed in, Check with me | Date | Calendar: Fri 30 Oct | **Wrong** (Sat 31 Oct in the header and the call request) | Weekdays, "tonight" and "tomorrow" resolved on the calendar; tests — this release |
| V21 | same | Taste for "suya" | — | **Wrong** (matched "Suyash Restaurant", pulling in Chinese and Indian) | A like must appear in an entity's name as whole words; test — this release |
| V22 | same | Approved plan = executed plan | The plan on screen (NOK by Alara, Fri 20:00) | **Different** (the call request was for Pizze-Riah, Sat 18:00): the approval reached another server instance, which re-planned | Plan and results sealed (gzip + HMAC-SHA256) at the checkpoint and sent back with "Do it"; an approval for an unrecoverable plan is refused, never applied to a new plan; tests — this release |
| V23 | same | Real call to the demo line | Vercel runtime log | **Blocked**: Vapi 400 "Free Vapi numbers do not support international calls" | Needs a paid number (Telnyx or Twilio) imported into Vapi; nothing else changes |
| V24 | Re-run after the fixes, Telnyx line | Date, venue, approval | Calendar; plan on screen | Correct: "Call Food Shack to book a table for 2, Fri, 30 Oct 2026 at 20:00" | — |
| V25 | same | Checkpoint asked a signed-in user to type name and email, and named the venue's number while the demo line would ring | — | **Friction / misleading** | Name and email filled from the account; checkpoint says "I'll call your demo line … as if it were …" — this release |
| V26 | same | Time asked ("at 8pm") | The request | **Wrong**: the call asked for 19:30 | Asked time read from the request and held on the named meal; planner told; tests — this release |
| V27 | same | Real call via Telnyx line +1 618 260 1647 | Vapi call status | Vapi accepted and placed the call; it ended with "assistant did not receive customer audio" | Under investigation (audio path between Telnyx and Vapi) |
| V28 | First dinner run (08:08) | Number dialled | Vapi call log | **Real business number** (+234 810 680 0744) was dialled instead of the demo line; the call failed before connecting, nobody was reached | Calls now fail closed: a business is dialled only with `CALLS_LIVE=1` and no demo line; tests — this release |
| V29 | Lagos dinner, retry call | Real call, voice both ways | Transcript | **Worked**: the assistant asked for the table, the "restaurant" confirmed, the assistant read it back | Turn-taking and transcription tuned; agreed details captured as data |
| V30 | Lagos dinner (auto) | Day and time | Request: "this Friday at 8pm" | **Wrong**: Sat 31 Oct 19:20, and a hotel for a dinner in the person's own city | Asked day and time held on the plan; a meal in your own city is one evening with no hotel; tests |
| V31 | Lagos dinner | Day 1 stops | — | **Not clickable** (no pinned place) | Every stop opens a card |
| V32 | Lagos dinner | Add to calendar in Bookings | — | **Missing button** | Button added; downloads the trip's calendar file |
| V33 | Lagos dinner | Taste | Request names afrobeats and suya | **"Because you love Drake"** from an older trip | Request likes lead; saved likes only fill in when none are named |
| V34 | Any trip, tab in background | Camera | — | **Stuck on the globe** | Lands in the city when the tab is shown again |
| V35 | Site check | Hilton, example.com, a missing domain, 127.0.0.1, OpenTable | Live | Live / live and framable / "doesn't exist" / refused / "slow, couldn't confirm" | — |
| V36 | Tokyo, auto | "That's the trip" popup | — | **Off-centre**: the entry animation's transform overrode the centring | Centred with `translate`, which animations don't override |
| V37 | Tokyo, auto | Pause button while playing | — | **White on white** label on the dark bar | Dark glass with a purple ring and white label |
| V38 | Wallet, NGN | Balance on the card | ₦27,198,238 | **Cut off**, currency pill clipped | Fits at any width (container-sized), narrow symbol |
| V39 | NYC, auto | Bookings | All reservations | **One booked**, rows needing a phone not actionable | Checkout approves all; each prepaid; phone + "Pay & call me" on the row |
| V40 | Checkout | Wallet short | — | — | Approve disabled with a clear message; nothing paid |
| V41 | Code review | Call that can't be placed after prepaying | — | **Payment kept, no booking** | Prepayment refunded when the call fails to start; test |
| V42 | Code review | Checkout total with a non-USD price | — | **Left out of the total** | Every amount converted at the day's rate |
| V43 | Code review | Receipt in naira | — | **Division by a rounded zero** (1 NGN rounds to 0 US cents) | Converted with the rate itself |
| V44 | Code review | Refund endpoint | — | **Could refund any payment** | Call prepayments from the last 24 h only; rate limited |
| V45 | Live site, signed out | Console | — | **401 errors** from search history and wallet polling | Signed-out history returns empty; wallet stops polling without a session |
| V46 | Build | `next build` with every route | — | Compiles, no type errors | — |

## Automated tests

- `packages/engine/test/weekend.test.ts`: weekend, long-weekend and explicit-date resolution; id-to-name replacement.
- `packages/engine/test/trip-travel.test.ts`: travel options keep only sourced prices; one best option; unknown modes.
- `packages/engine/test/flights.test.ts`: no test-airline fares surfaced.
- `apps/web/test/adventure.test.ts`: world model geography (airport north of Alfama, Belém west), route coordinates within the city, Qloo zone and heat bounds.
- `packages/engine/test/booking.test.ts` (calls fail closed): no business is dialled without the live switch; the demo line replaces the business.
- `apps/web/test/run-seal.test.ts`: a sealed plan round-trips exactly; tampered, foreign and expired seals are rejected.
- `packages/engine/test/booking.test.ts` (prepaid from the wallet): a reservation is held, captured with a BL reference and returned with its receipt before the call; a short wallet stops the call with a clear message.
- `packages/engine/test/booking.test.ts` (refund on failed call): a prepayment is refunded when the call can't be placed.
- `apps/web/test/place-in.test.ts`: destination read from the request ("…TO LONDON FOR ME…" → London).

Run all: `npm test` (engine 283, web 25 at time of writing).
