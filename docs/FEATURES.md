# Backline: features

What the product does today, how each part works and how it's checked. Engine tests live in `packages/engine/test`.

## Planning anything outside the home

### Understanding the request
- One sentence, typed or spoken, in any language. Attached tickets, bookings or itineraries fill in what the sentence leaves out.
- Extracts destination, dates (relative dates resolved), people, rooms, budget, what's needed (stay, food, venue, things to do), a landmark, how they're travelling, what they're handling themselves, a celebrity to plan like and the things they love.
- Anything not stated is dropped, including a landmark the model guessed. Assumptions are shown and can be corrected.
- Tests: `missions.test.ts`, `taste.test.ts` (likes, grounding).

### Taste, read by Qloo
- Each thing they love becomes a Qloo entity or tag; a celebrity's taste leads when they plan "like" someone.
- The taste card shows the vibe, scenes, dishes, the age group that shares the taste, the price level it leans to, what fans also love and the part of town where it's strongest.
- The heatmap is drawn on the map with the taste zone ringed. Without a landmark, searches centre on that zone.
- Every place from Qloo gets a taste match (from its affinity rank), shown as a ring on the card and used in scoring.
- Tests: `taste.test.ts`.

### Finding and checking places
- Qloo and OpenStreetMap searched together and merged, with distance, rating, price level and contacts.
- Hotels always cover 5 km around the focus plus the best-rated hotels within 10 km.
- Web research checks prices, booking emails, phones and websites for the top picks. Contacts must appear in the cited page.
- Hotel prices: a live rate, a price listed for the dates (with its page), or a quoted price from research. Otherwise "No price listed for your dates".
- Tests: `trip.test.ts`, `trip-agent.test.ts`, `free-research.test.ts`.

### Hotel lanes
- Premium, closest, best value and lowest price, each leading with a different hotel where possible, with the price source linked and one-tap call, website, map and date check.
- Tests: `tiers-rides.test.ts`.

### The plan, the map and getting around
- Day-by-day plan with times, notes, a budget and tips, written from the agent's picks only.
- Map with each day's route on real roads, numbered stops, the taste heatmap and a round-trip view from the home city.
- Ride fares between stops from published rates, with a ride link; walking for short hops.
- Tests: `routes-docs.test.ts`, `tiers-rides.test.ts`.

### Review, approve once, and it books everything
- **Review:** swap any stop for Qloo's next best of the same kind, remove it, or describe a change; only the plan is rewritten, in seconds.
- **One-tap checkout:** when the trip is ready a centred checkout opens by itself (both modes): every booking with its amount, the total in the traveller's currency, the wallet before and after, and "Approve & pay" or "Take a look first". The approval is sealed to the exact plan shown.
- **Prepaid, then confirmed:** each reservation and stay is paid from the Backline Wallet, then confirmed by a real AI call, one at a time, day by day. A place that can't take it hands over to Qloo's next best (up to three), then the website (checked live, opened in a mini browser). A booking nobody could take is refunded automatically; a call that can't be placed is refunded too.
- **Receipts:** every payment has a printable receipt (`/receipt/<id>`) to show on arrival.
- **Demo calls** ring the signed-in person's own phone (they play the business). Real businesses are called only with `CALLS_LIVE=1`.
- Also: booking links with dates filled in, reservation emails, the whole plan as a calendar file. Hotels and flights book through LiteAPI and Duffel (sandbox in the demo).
- Only a signed-in person can have things paid, emailed or called; everyone else gets the plan and links. A repeat of the same request within six hours isn't booked again unless the person taps Run again. Limits per mission: 4 emails, 8 calls, 1 room reservation. Calls say they're from an AI assistant and never give or ask for card details.
- Tests: `booking.test.ts` (fail-closed calls, call outcomes, booking reader, Backline references, prepayment, refunds), `run-seal.test.ts`, `site-check.test.ts`.

### Wallet and identity
- **Backline Wallet:** a database ledger with a $20,000 demo balance per person, shown in their own currency. Turn the card over, switch currency, add any amount, filter activity, open any payment for its receipt. Holds, captures and refunds run in database functions under a per-person lock.
- **Identity verification** with Persona (ID photo and selfie); paid flights and hotels wait for a verified traveller when Persona is configured.
- **Traveller record:** legal name, contact, date of birth, gender, nationality, residence, address, emergency contact, seat, meal, loyalty programmes, accessibility, dietary and hotel preferences, grouped and collapsible. The passport is stored encrypted.

### Taking it with you
- Add to calendar (.ics), PDF, Word document, PowerPoint (.pptx) and a web slide deck to present. The taste profile is included in each.

### Reliability
- The agent has turn, call and time limits; an autopilot finishes when the model stalls; every provider has a fallback; slow services have a fixed budget.
- A diagnostics panel (`?debug=1`) shows every model call, web call and agent decision.
- Tests: `runtime.test.ts`, `reliability.test.ts`, `self-tuning.test.ts`.

## For artist teams

Built on Qloo's audience data for an artist:
- **Fans:** what fans love across categories, fan DNA, age and gender, segments, comparison with another artist.
- **Brand deals:** brands the fans already love, live research, grounded pitch emails, head-to-head comparisons, a one-page PDF per pitch.
- **Tours:** where the taste is strongest, venue shortlists, a routed tour, fan experiences.
- **Growth and content:** collaborators, new markets, press, content angles, ad targeting, merch, a release plan.
- Tests: `skills.test.ts`, `brand.test.ts`, `tour-growth-content.test.ts`, `compare.test.ts`.

## Around the product
- Follow-up questions answered from a mission's findings (`followup.test.ts`).
- Preferences: home city, currency, budget style, dietary needs and things they love, importable from another assistant.
- Accounts: sign in with Google or an email link. Details are saved to the account and used for bookings; each finished trip is saved; the agent remembers tastes, cities and hotels and uses them on the next trip. Travel documents: a passport saved encrypted with consent, shown masked, used only to book flights that need it (`vault.test.ts`, `flights.test.ts`). Search history with one-tap re-run, on the account page and under the home prompt. All editable at `/account` (`apps/web/test/account.test.ts`).
