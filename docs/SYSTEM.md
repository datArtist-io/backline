# Backline — System Specification

**Status:** authoritative description of the system as built. **Version:** 2026-10-27. **Applies to:** `main` from commit `c237ec3` onward.

Where this document and the code disagree, the code governs and this document is to be corrected. Every statement here can be checked against the file it names.

---

## 1. Definitions

1.1 **Person** means the human using Backline, signed in or not.
1.2 **Request** means the sentence (and any attached documents) the Person submits.
1.3 **Mission** means one run of the engine on one Request, identified by a `runId`.
1.4 **Skill** means a single, typed unit of engine work (`packages/engine/src/skills/*`) whose output is validated with Zod before any other part of the system may use it.
1.5 **Action** means a step that affects the world outside Backline: a booking, a payment, an email, a phone call or a calendar entry (`buildActions`, `packages/engine/src/skills/trip.ts`).
1.6 **Approval** means the Person's explicit go-ahead for a set of Actions, given with one button ("Do it") at the Actions checkpoint, or given in advance by choosing **Just do it** before the Mission starts.
1.7 **Test mode** means a provider's sandbox: LiteAPI keys starting `sand_`, Duffel tokens starting `duffel_test_`. In Test mode bookings are created and confirmed by the provider and return real references, but **no money moves**.
1.8 **Demo line** means the phone number in `CALL_DEMO_TO`. When set, every booking call rings the Demo line instead of the business.
1.9 **Expedition** means the full-screen, real-Earth interface for trip Missions (`apps/web/src/app/adventure/*`).

## 2. Purpose and scope

2.1 Backline turns one sentence into a researched, taste-matched trip and then **executes it**: it books, pays, emails and calls on the Person's behalf after Approval.
2.2 The core loop, in order, is: (a) understand the Request; (b) read the Person's taste through Qloo; (c) research places, travel, weather, money, rules and guides from cited sources; (d) write an hour-by-hour plan; (e) propose Actions; (f) obtain Approval; (g) execute Actions; (h) report every outcome with its reference.
2.3 Qloo is the primary signal for *what* is recommended (§4.2). Large language models decide *how* to search and write prose; they may not originate facts (§5).

## 3. The Mission lifecycle

A Mission is a dependency graph of Skills run by the orchestrator (`packages/engine/src/orchestrator*`, plan in `missions.ts`). For a trip (`mission = "plan"`) the Skills are, in dependency order:

| Stage | Skill id | What it does | Primary sources |
|---|---|---|---|
| S0 | (planner) | Routes the Request to a mission; extracts destination, dates, party, budget, likes. Weekends are resolved on the calendar, not by the model (§5.6). | Nemotron (Nebius) |
| S1 | `trip.taste` | Resolves the Person's tastes to Qloo entities and tags; fetches vibes, scenes, dishes, audience, "fans also love", and the destination **heatmap** and strongest **taste zone**. | Qloo Insights, Tags, Heatmap |
| S2 | `trip.travel` | How to get there from home: modes, durations, fares, each cited. | Web search (route planners, fare and timetable pages) |
| S3 | `trip.flights` | Bookable flight offers. Suppressed in Test mode (§5.4). | Duffel |
| S4 | `trip.agent` | A ReAct agent searches stays, food, venues and activities around the taste zone or landmark, and picks. | Qloo `urn:entity:place`, OpenStreetMap, LiteAPI |
| S5 | `trip.plan` | Writes the day-by-day plan using only listed places (§5.2). | Nemotron |
| S6 | `trip.routes` | Real road and walking routes between each day's stops. | OSRM / OpenStreetMap |
| S7 | `trip.intel` | Field guide: forecast or historical weather, money and exchange rate, public holidays, entry, safety, health, culture, connectivity, emergency numbers, phrases, local guides, taste tips. | Open-Meteo, Nager.Date, exchange-rate API, web search |
| S8 | `trip.actions` | Builds the Actions (§6). **Checkpoint:** stops for Approval unless the Person chose Just do it. | — |
| S9 | `trip.execute` | Executes approved Actions (§6–§8) and returns one result per Action. | LiteAPI, Duffel, Resend, Vapi |

3.1 Every Skill streams progress (`StepProgress`). The Expedition shows progress as named chapters, not as model text.
3.2 A Skill that fails returns a typed failure; the Mission continues with what it has and says what is missing ("gaps").

## 4. Sources of truth and provenance

4.1 Every place carries its `source` (`qloo`, `osm`, `hotels`, `qloo+osm`) and, where web-derived, `sources[]` with URLs.
4.2 **Qloo affinity** is shown as Qloo's own score (0–1, three decimals) together with an honest rank within its kind ("#1 of 6 stays Qloo scored for your taste"). It is **never** shown as a percentage "match": raw scores cluster closely (observed 0.97–0.997 in Lisbon), and a rank rendered as a percentage would overstate certainty.
4.3 Coordinates come from Qloo or OpenStreetMap and are drawn unmodified. The 3D layer re-anchors to the camera centre each frame using a mercator-exact local frame so that beams and pins coincide at every zoom (`Earth.tsx`, `local()`, `reanchor()`).
4.4 Weather is Open-Meteo's forecast when the dates are within range, otherwise a three-year historical average for the same dates, and is labelled accordingly.
4.5 Imagery: satellite tiles © Esri, Maxar, Earthstar Geographics; vector data © OpenStreetMap contributors via OpenFreeMap; terrain from AWS Terrain Tiles; Photoreal mode (optional) © Google. Attributions are displayed in the map credit control, collapsed by default and opened by the ⓘ button.

## 5. Accuracy policy — what is never invented

5.1 **Places:** the agent may select only ids its own searches returned. Unknown ids are discarded.
5.2 **Plan:** the planner may reference only listed places; each place is described to it with its kind (Qloo/OSM tags) so meals match what a place is (a gelateria is not dinner). Ids written into prose are replaced with names, and a name already present is not repeated (`nameRefs`).
5.3 **Prices:** a hotel price is shown only when it is (a) a live provider rate outside Test mode, or (b) listed on a cited page for the Person's dates. Nothing is estimated (`hotel-tiers.ts`).
5.4 **Test-mode rates and fares** are never presented as prices. Sandbox hotel rates are attached with `offer.test = true` and are shown only as "Bookable in test mode (sandbox: no real price, no money moves)". Duffel test-airline fares are not shown at all.
5.5 **Events:** the plan may not state that a show, concert, match or performance is on at a time unless the research notes confirm it; otherwise it must say "See what's on at …" and to check the schedule.
5.6 **Dates:** "a weekend", "this weekend", "next weekend" and "a long weekend" are resolved deterministically (`weekendDates`): Friday–Sunday, long weekend Friday–Monday, with explicit dates taking precedence. Tested in `packages/engine/test/weekend.test.ts`.
5.7 **Travel:** a mode of travel appears only if a source shows it exists on the route; a price only with its source (`shapeTravel`).
5.8 **Arrival and departure times** are not invented when nothing is booked; the plan says "Arrive" and leaves the time to the Person.

## 6. Actions, Approval and limits

6.1 Actions are proposed in S8 and shown at one checkpoint with a single **Do it** button. Nothing in §7–§8 happens before Approval.
6.2 Per-Mission limits (`ACTION_LIMITS`): **4 emails, 3 calls, 1 room reservation**.
6.3 With sign-in enabled, a signed-out Person receives the full plan and links but no Action is executed for them (`api/mission/route.ts`: `ctx.signedOut`, providers nulled).
6.4 The same Request is not booked twice within six hours unless the Person taps **Run again** (`alreadyBooked`).
6.5 Automatic booking covers **one traveller** for flights and **one room** for hotels; larger parties get links, because each traveller and room needs its own details.
6.6 A hotel is paid only at the approved price (≤ +2 %, or ≤ +25 % when an equivalent hotel is substituted after a sell-out) and within the trip's budget; otherwise the room is **held** and the Person is asked.

## 7. Voice calls

7.1 Calls are placed through Vapi on the Telnyx numbers attached to the account (`VAPI_PHONE_NUMBER_ID`).
7.2 The assistant **always discloses** that it is an AI calling on the Person's behalf, **never** gives or asks for card or bank details, **never** agrees to charges, reads back what was agreed (date, time, party, name, reference), and leaves a short voicemail when unanswered (`callInstructions`).
7.3 **Demo line.** When `CALL_DEMO_TO` is set to an E.164 number, every booking call rings that number, where a person plays the business. The call is real; the business is not involved. The result message states that the Demo line was used. This is the default recommended configuration for demonstrations, so that no real business is asked to hold a reservation for a demo trip.
7.4 Call status and transcript are fetched from `/api/calls/[id]` (signed-in, rate-limited) and shown live in the Bookings panel.

## 8. Payments and bookings

8.1 Hotels: LiteAPI **prebook → book** using the account's payment method. In Test mode the provider simulates payment and returns a booking reference; the result says "Test booking: no real money moved".
8.2 Flights: Duffel order creation for one traveller with passport details decrypted server-side for that call only. In Test mode the booking is on Duffel's test airline.
8.3 Card details never pass through Backline.
8.4 The Bookings panel shows, for each booked Action, the confirmation reference and the amount, labelled **Test payment** and **Test mode · no money moved** whenever Test mode applied.

## 9. Personal data

9.1 Passports are encrypted with AES-256-GCM using a server-only key (`TRAVEL_DOCS_KEY`), bound to the user id as associated data (`lib/vault.ts`). They are never sent to a model, a log, an event or the browser.
9.2 Requests, documents and preferences are sent to the model providers needed to answer them and are not used for anything else.
9.3 Voice input is transcribed and not stored.
9.4 The theme choice is stored only in the browser (`localStorage: bl.theme`). Geocoding guesses are cached in `sessionStorage` for the tab.
9.5 Security controls are listed in `SECURITY.md`.

## 10. Failure modes and how they present

| Failure | Behaviour |
|---|---|
| A tile host is down | The globe still renders from satellite; vector layers are optional and added after load. |
| WebGL unavailable | The classic view is offered. |
| A Skill fails | Its chapter shows as skipped; the field guide lists "Couldn't find: …". |
| A room sold out at booking | The next-best bookable hotel is held within the approved price limit (§6.6). |
| A call is not answered | Voicemail is left; status shows "Call finished" with the reason. |
| Photoreal key missing or invalid | Photoreal is not offered; Satellite is used. |

## 11. Configuration

All keys are server-side except those prefixed `NEXT_PUBLIC_`.

| Variable | Purpose | Required |
|---|---|---|
| `QLOO_API_KEY`, `QLOO_API_URL` | Qloo taste data | Yes |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL(_FAST/_STRONG)` | Nemotron via Nebius | Yes |
| `ANTHROPIC_API_KEY` / web search keys | Cited web research | Recommended |
| `LITEAPI_API_KEY` | Hotels (sandbox `sand_…` = Test mode) | For booking |
| `DUFFEL_API_KEY` | Flights (`duffel_test_…` = Test mode) | For flights |
| `RESEND_API_KEY`, `ACTIONS_FROM_EMAIL` | Emails to businesses | For email |
| `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_MODEL` | Voice calls | For calls |
| `CALL_DEMO_TO` | Demo line (§7.3), E.164 | Recommended for demos |
| `TRAVEL_DOCS_KEY` | Passport encryption (32 bytes, base64) | For flights |
| Supabase variables | Sign-in, accounts, trips | For accounts |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Photoreal 3D Tiles (Map Tiles API), restricted by HTTP referrer | Optional |
| `NEXT_PUBLIC_SATELLITE_TILES`, `NEXT_PUBLIC_VECTOR_TILES`, `NEXT_PUBLIC_TERRAIN_TILES` | Override map providers | Optional |

## 12. Verification

The checks run against live Missions, their findings and the resulting fixes are recorded in [`VERIFICATION.md`](VERIFICATION.md). Automated tests: engine 265, web 20 (`npm test`).

## 13. Known limitations

13.1 Photoreal buildings require a Google Map Tiles key; without it buildings are OpenStreetMap extrusions.
13.2 Hotel prices outside Test mode depend on what is listed online for the dates; some hotels show "Not listed".
13.3 The planner is a model: §5 constrains it and §12 audits it, but its prose can still be imperfect; facts in the plan are traceable to listed places and cited notes.
13.4 Event schedules are not fetched from ticketing systems; the plan defers to the venue's schedule (§5.5).
