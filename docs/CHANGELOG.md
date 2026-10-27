# Changelog

## 2026-10-27

### Checkout, wallet and identity
- One-tap trip checkout: approve the whole trip once; each booking prepaid from the wallet, confirmed one call at a time, refunded automatically if no place can take it.
- Receipts for every payment (`/receipt/<id>`), printable; linked from Bookings and the wallet.
- Interactive wallet: turn the card over, switch currency, add any amount, filter activity, open any payment.
- Identity verification (Persona) always visible under Wallet & ID; full traveller record in collapsible groups.
- Prices in the traveller's own currency; trips start from where they are.
- Plane flies the arc on the way in; agent exchange and live conversation on each booking.

### Execution
- Demo calls ring each signed-in person's own phone; every reservation across the days, one call at a time; agreed details captured as a reservation card; "fully booked" or no connection moves on to Qloo's next best.
- Backline Wallet (demo balance) with database-checked holds and captures for hotel and flight payments.
- Identity checks with Persona; paid bookings wait for a verified traveller.
- Home page example requests.
- Review before booking: swap (Qloo's next best first) or remove any stop, or describe a change; only the plan is rewritten, in seconds; nothing is booked until "Review & book".
- Calls report a plain outcome, retry once automatically, then offer the website, email or calling yourself; other bookings carry on.
- Mini browser for website bookings, after a live check of the site (public hosts only).
- Bookings panel inside the expedition: live call status and transcripts, receipts with confirmation numbers, test-mode labels.
- `CALL_DEMO_TO` demo line: real AI calls ring a number where a person plays the business.
- Sandbox hotel rates restored for test-mode book-and-pay, labelled everywhere and never shown as prices.

### Accuracy
- Approvals bound to the exact plan shown: the plan is sealed (HMAC) at the checkpoint and resumed from the seal on any server; an unrecoverable plan is never booked or called.
- "This Friday", "tonight", "tomorrow" resolved on the calendar.
- Likes match named things only as whole words ("suya" is not "Suyash Restaurant").
- Qloo affinity shown as Qloo's own score with rank, not rank-as-percent.
- Weekends resolved on the calendar; no dates → coming long weekend, stated.
- Origin always known: stated, home city, or connection city, stated.
- Planner sees each place's kind; no doubled names; no unconfirmed events; no invented arrival times.
- "Getting there" research from route planners, fare and journey-time pages; fare and time on the flight arc.
- Test-airline fares never surfaced.
- Taste never empty: with no likes given, the destination is read through Qloo (what people who love it go for), and the trip says so.

### Experience
- Liquid Glass control layer after Apple's HIG (regular variant, specular rim, reduced-transparency and high-contrast fallbacks); thick readable material for content; AA contrast across every screen.
- Full-screen expedition on the real Earth (MapLibre globe, satellite, terrain, 3D buildings) with a Three.js layer: beacons, Qloo taste columns, trees, clouds, rain, sunlight, traveller.
- Optional Photoreal mode with Google Photorealistic 3D Tiles.
- Cinematic grade by hour and weather, tilt-shift, time-of-day scrubber, light and dark themes, deep-space backdrop.
- Landing-page design language: glass, pills, sheen title, sliding segmented control; animated icons; 2×2 facts.
- Worldwide defaults; Lisbon sample trip with coordinates checked against OpenStreetMap.
- Faster: destination read from the sentence, tiles preconnected, no tile cancellation while flying, lighter redraws.
