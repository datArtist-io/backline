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

## Automated tests

- `packages/engine/test/weekend.test.ts`: weekend, long-weekend and explicit-date resolution; id-to-name replacement.
- `packages/engine/test/trip-travel.test.ts`: travel options keep only sourced prices; one best option; unknown modes.
- `packages/engine/test/flights.test.ts`: no test-airline fares surfaced.
- `apps/web/test/adventure.test.ts`: world model geography (airport north of Alfama, Belém west), route coordinates within the city, Qloo zone and heat bounds.
- `apps/web/test/run-seal.test.ts`: a sealed plan round-trips exactly; tampered, foreign and expired seals are rejected.
- `apps/web/test/place-in.test.ts`: destination read from the request ("…TO LONDON FOR ME…" → London).

Run all: `npm test` (engine 265, web 20 at time of writing).
