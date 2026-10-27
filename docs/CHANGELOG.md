# Changelog

## 2026-10-28

### Talk to Backline (voice)
- **Call Backline**: a real phone number (+1 618 260 1647, Telnyx through Vapi) that answers as the agent. Say where you're going and what you love; it plans the trip on the call, reads out a 4-digit code, and the trip appears on the home page under that code (and is emailed when the caller is signed in). Only real inbound calls are accepted, checked with Vapi.
- **Talk in the browser**: the same agent over the microphone (Vapi Web SDK); when the call ends with a trip, the page opens it. Shown only when a valid Vapi public key is set.
- **Concierge briefing call**: when every booking of a trip is done, Backline rings the traveller's saved phone once with a short spoken briefing of what was booked; "Call me again" repeats it (4 per person per day).

### Landing and mobile
- Smoother first load: the 3D scene pauses off screen and in background tabs, and the trip page prefetches only when the browser is idle.
- Steadier layout: suggestion chips keep fixed slots and cross-fade every 9 s, so nothing jumps.
- Mobile: a centred voice card, a slim prompt that only grows when you type, a globe framed to the screen, round ticks, and the review bar no longer overlaps the last stop.
- Link previews: an Open Graph and X card image for the site.

### Accuracy
- Trips start where the visitor is: the origin is taken from what they said, then their home city, then their connection; a guessed origin is never used.
- The star and the tastes you name always lead: a trip "the way Pharrell would" uses Pharrell's taste, not likes saved from earlier trips.
- Flight times that can't fit the distance (New York to Paris in 3 h 30) become a clearly labelled estimate ("about 7 h 30, estimate").
- Trip summaries speak to the traveller ("your tastes"), never "the client".
- The demo account's wallet was reset to $20,000 and set to US dollars.

### Account
- A saved trip can be planned again in "Check with me" mode, so nothing is booked or paid without your approval.
- Fixed: "New trip" text sat at the top of its button on phones; the receipt page title repeated the brand name.

### Launch film
- A 42-second launch film built in code (`launch-film/`): every frame is a pure function of time, with an original score synthesised on the same beat grid. See [launch-film/README.md](../launch-film/README.md).

## 2026-10-27

### The full payment slip
- One slip for everything the trip needs, grouped: flight out and flight back (separate tickets), airport transfers and every ride, the hotel for every night, each table, and the rest of the planned spend (tickets, entry fees). One tap pays it all, with a receipt for each.
- Hotel availability: the agent keeps the planned hotel only if it has rooms on the dates within budget; otherwise it books the best available hotel for your taste and says why, and the plan is rewritten around it.
- Getting there: four search angles (route planners, fare sites, airline and rail timetables, journey times). When no source lists a fare, a clearly labelled distance-based estimate keeps the tickets on the slip.
- Rides: typical ride-hail rates for every city, so every trip can budget its rides; each ride opens in Uber where it runs.
- "Call me now" on the home page: a visitor's own number, a consent tick, a two-minute AI demo call; limited per visitor, per number and per day.
- "Back to your trip": stepping away to Account or a receipt and coming back resumes the trip exactly as it was, calls included.
- The menu stays usable while the trip plays. The checkout fits every screen. The mode tip no longer covers the suggestions, which now rotate through celebrity, cross-domain taste and fan trips.
- The wallet paints instantly from the last balance seen and refreshes in place; the server reads balance, activity and cached rates in one round trip.

### Fixes
- A prepayment is refunded when its call can't be placed.
- Checkout totals include prices in any currency, at the day's rate.
- Receipts convert small-unit currencies correctly (naira, yen).
- Refunds limited to call prepayments from the last day; wallet pay and refund rate limited.
- Demo calls ring the account's saved phone; "Pay & call me" saves the number to the account.
- No 401 noise for signed-out visitors; the wallet stops polling without a session.
- The wallet lays out by its own width (container queries), so it fits inside the trip sheet.

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
