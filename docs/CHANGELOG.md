# Changelog

## 2026-11-04

### Documentation and policies
- Terms of use at `/terms` (AI use, how prices work, approval, the demo wallet, refunds and cancellations, fair use, liability), linked from the footer and the privacy notice.
- The privacy notice is current: every service that receives data (Google Flights through SerpApi, Google's 3D tiles, Groq, Anthropic, Persona, Telnyx, Vercel), cookies and storage, the calendar link, deleting a whole account, and that accounts are for adults.
- New docs: API reference, third-party services, deployment, runbook (with a show-day checklist), testing, and decision records for the agent, prices, demo checkout, Qloo and the 3D city. The architecture doc describes the agent as it is now. Security: disclosure policy, incident response, public keys.
- GitHub: contributing guide, code of conduct, issue and pull request templates, and CI (type check and tests on every push and pull request).

### Flights always on the slip, live fare when there is one
- Getting there and back is always on the payment slip. The fare, best first: the live Google Flights fare for the dates; a fare listed online for the route; an estimate from the distance (recalibrated on real fares: Lagos–Rome about $560 one way, not $297). Anything but the live fare carries an "est." tag on the slip and says the live fare replaces it, and the agent calls it an estimate. Turning SerpApi on (or it answering again) swaps in the live fare by itself.
- Google Flights answers are kept for 6 hours (Next.js data cache), so practising the same trip doesn't spend searches.

### A real airliner flies the journey in
- The plane is a detailed jet (shaded fuselage and swept wings, two engines, a tail in Backline's colours) with real navigation lights: red on the left wingtip, green on the right, a white tail strobe. It's about four times the old icon, grows as it climbs, and its own silhouette falls away beneath it as a shadow.
- Fixed: it pointed north for a moment at take-off and landing (its heading came from two identical points) and then snapped round; it now starts on its heading and turns smoothly. It no longer stretches near the edge of the globe (it was laid onto the surface; it now faces the screen).

### Slip and trip polish
- The 3D city keeps filling in. Google refuses tiles for a while when too many are asked for in a minute (the trip's preload asks for thousands), and a refused tile was never asked for again, so parts of the city stopped loading. Refused tiles are now asked for again after a pause (4 s, doubling to a minute), and the city only falls back to satellite if its root fails three times.
- The trip opens in the right theme from the first paint. It drew in light for the seconds the scripts took to load (grey buttons and a grey bar on the dark page), then switched; the saved or system theme is now set on the page before it draws.
- Your phone fills itself on the payment slip: from your account, or the number you used last on this browser. It was only fetched when the name or email was missing, so signed-in people always saw an empty box. A number typed on the slip is saved to the account.
- Fly the trip is steadier: about 1.8 seconds per km, 15 to 36 seconds a day, with a longer beat at each stop (9 to 24 rushed past the buildings).
- The 3D city still loads ahead of Fly the trip, but quietly: the "Preparing 3D city" pill is gone.
- The currency switch moved from the trip's top bar to your account ("Prices in"), next to Security. It still applies everywhere.

### The agent decides travel and events too
- Getting there and what's on are now tools the ReAct agent chooses: `find_travel` (real Google Flights fares for the dates and travellers, plus trains and buses) and `find_events` (concerts, matches, festivals on the dates, ranked by taste). It reads the fare against the budget ("That leaves about $540 of the $3,000 budget: tight, so lean to cheaper stays") and plans around an event it found. The autopilot uses the same tools.
- The steps after the agent reuse its answers (one lookup per run, shared), and only fetch themselves when the agent didn't, so nothing is asked twice and no fare search is wasted.
- The trace names the loop (reason, act, observe) and labels the new tools; the README describes the agent and its tools.
- A tool that fails twice in a row is switched off for the rest of the run, and the model is told, so it works with what it has instead of spending its turns retrying (live, the out-of-credit web search used up all 8 turns and the autopilot had to finish). A provider asking for payment (402) counts as web research being down.
- The model keeps control to the end. Live, the backup model on Groq sometimes wrote a native tool call instead of plain JSON; Groq refuses that with a 400 ("Tool choice is none, but model called a tool") and the autopilot took over after two. The call it meant is in the error, so it's now recovered and run as that turn's decision. That 400 is no longer mistaken for "model not available".
- Turns where the model "waits for results" are gone: it's told tool results are never pending.
- The model finishes its own work: with two more tools it needed more room (10 turns, 24 calls), and when its turns run out it gets one last finish-only turn before the autopilot is considered. Namespaced tool names some models write ("repo_browser.search_places") are read as the tool.
- Its self-check sends a finish back once when it never looked at getting there, so it always weighs the real fare against the budget itself.
- The backup model now and then returns an empty answer; the model now keeps control through two misses in a row (three hand over to the autopilot, not two).
- Live: Rome from Lagos, Tokyo from London and Barcelona from Paris ran as "agent", each calling find_travel and find_events itself (the model chose every step and finished itself), 36 to 41 s.
- Tests: the agent's fare reasoning, reuse by the fixed steps, the model choosing the tool, autopilot, per-run sharing, switching off a failing tool, recovering refused tool calls, the last finishing turn, the travel self-check, riding out model misses (engine 441).

### Flight prices are real or not charged
- Fares come from Google Flights (through SerpApi, `SERPAPI_API_KEY`): the actual price for this route, these dates and this many travellers, out and back priced separately, from every airport in the city. Among flights within 40% of the quickest journey, the cheapest is picked, so a 30-hour detour never wins on price.
- (Superseded later the same day: flights stay on the slip with a labelled estimate.) Without a real fare the slip showed "Compare live fares" instead of a price.
- Tests: Google Flights fare picking and request, live-only charging (engine 427).

## 2026-11-03

### Real Google Earth city
- Photoreal 3D now loads Google's buildings on the globe view. MapLibre gave no camera height there, so the tile loader never went past the root and the map fell back to satellite.
- Buildings appear solid (the fade-in froze half-transparent when the map went idle) and stand at street level: the ground is probed over a small grid, and readings from coarse far tiles are ignored.

### Routes on the real streets, and a brisker flight
- On the 3D city, routes are ribbons laid on the actual street height (measured from Google's tiles by casting rays straight down, a few points a frame, refined as finer tiles arrive) and depth-tested against the buildings, so a route passes behind a building instead of being painted across it. They widen with the zoom so they read from far out. The flat map lines are hidden on the 3D city and still used on the satellite and painted maps.
- Road routes follow real streets more often: both routing servers are asked at once, and every day is routed in parallel on its own (one day failing used to send every later day to straight lines). A day that still has no road route lies over the rooftops instead of vanishing into buildings.
- While a day is flown, only its route shows, and the flown stretch turns white along it.
- Fly the trip is about twice as quick: roughly a second per km, 9 to 24 seconds a day (it was up to 46), with a shorter beat at each stop.
- Tests: route point spacing (web 47).

### Real prices, whatever the model
- Money never comes from the model. The plan's budget is rebuilt in code after the plan is written: flights from the live airline fare, else a fare listed online, else a distance estimate; the stay from its live rate, else the rate listed online, else an estimate for the price level; food from a fixed daily rate for the price level. Every line says where its number comes from. Only the food line is set aside on the slip (it used to turn any model-written line, like "Museum tickets $60", into a payment).
- Live prices, demo checkout: with live Duffel and LiteAPI keys the search is real (airline fares, hotel rates), but nothing is bought unless `BOOKING_LIVE=1`. "Booking" returns a `DEMO-` reference at the live price, paid from the demo wallet, and says no ticket or room was issued. Holding a hotel rate only locks the price, so it stays real.
- Tests: the computed budget (engine 424).

### Budget, food rules and cuisines honoured
- Flights estimated from distance cost far less per km on long routes: Atlanta–Singapore was priced at ~$2,000 each way per person (a $10,681 slip on a $7,000 budget); it's now ~$900, in line with real fares.
- A total budget is kept on the payment slip: if what's ticked runs over, optional extras are unticked (dearest table bookings first, then extras, then rides) and the plan says which; flights and the stay are never dropped. The slip shows "Your budget $7,000 · $X to spare" or "over by $X".
- Food rules are read from the request ("no pork", halal, kosher, vegetarian, vegan, nut or shellfish allergy, no alcohol) and are absolute: places built around what they don't eat (tonkotsu ramen, bak kut teh, rib houses, charcuterie; steakhouses for vegetarians) are dropped from every list and plan. Halal-tagged places always pass.
- Cuisines they name ("Italian and Korean food") are searched in Qloo through its own cuisine tags, with their taste, and count for more in ranking, so they aren't left to whatever is nearby.
- Qloo is never hit with a burst: at most 5 requests at once (the rest queue), and the extra searches (a kind of stay, named cuisines, now one call for all cuisines) start after the main taste search answers. A run that fired about 11 at once timed out every search.
- Tests: food rules, flight estimates, the budget guard, cuisines and the Qloo request limit (engine 423).

### The 3D city is ready before you fly the trip
- After landing, Backline loads the whole trip's 3D city in the background: virtual cameras along every day's route, set up exactly like Fly the trip's camera (zoom 16.1, tilt 64°, facing along the route), a few at a time, every few hundred metres (at most 100 viewpoints), each loading the street ahead (1.8 km) rather than the horizon. A small pill shows "Preparing 3D city · 40%", then "3D city ready".
- Buildings that have been seen stay in memory for the trip on laptops and desktops (up to about 1.2 GB), instead of being freed the moment they leave the screen; flying back no longer reloads them. Phones keep the library's smaller defaults.
- Google lets the browser keep each tile for 4 hours, so a tile that has to leave memory comes back from disk in ~60 ms; the cache holds up to 60,000-80,000 entries (most are small index files).
- Tiles unpack in parallel on all cores (it was 5 at a time, with hundreds waiting), with more downloads at once.
- Same fix elsewhere: satellite imagery keeps a larger cache on laptops (2,000 tiles), and place photos load as soon as the trip is known, so every stop card opens with its picture.
- Tests: trip viewpoints (web 45).

### Faster place searches
- Map data (OpenStreetMap's public Overpass servers) is asked of three servers at once and the first good answer wins, instead of one after another. A server that just failed is skipped for a minute (five if it hung), so later searches don't wait on it. Measured before: a place search waited out its full 11-second limit.
- Once Qloo (the taste data) has answered, map data gets 3 more seconds at most; a late answer is cached for the next search nearby, and isn't reported as a failure.
- Tests: the race, and no server asked twice (engine 417).

### Stays beyond hotels: Airbnb-style homes, hostels, B&Bs, resorts
- The request is read for the kind of stay: an Airbnb, apartment, villa or "place with a kitchen" is a whole home; backpacking or a hostel; a B&B, riad or guest house; a boutique hotel; a resort. What they say beats the model's guess, and "not a hotel" isn't read as a hotel. A saved stay preference ("Airbnb") counts when the request doesn't say.
- Groups of 4 or more and stays of a week or longer look at whole homes alongside hotels, and say so.
- A home stays a home: a hotel with a bookable rate never replaces the Airbnb-style pick.
- Search finds that kind too (Qloo's own tag for it, plus apartments, hostels, guest houses and chalets from OpenStreetMap) and ranks it first by taste; big hotel chains sink for someone who wants a home.
- Qloo leads the links too: they open in the neighbourhood where Qloo says the taste peaks (or by the landmark they named), not across the whole city.
- Whole homes open Airbnb (entire homes only) and Vrbo with the dates and guests filled in; hostels and B&Bs open Booking.com filtered to them. Airbnb has no public booking API, so these are links the person books themselves.
- Tests: reading, inferring, ranking and links (engine 416).

### The flight path fades after landing
- Once the plane touches down and the camera settles into the city, the flight arc and its route label fade out over two seconds. "Fly in again" brings them back for the replay.

### Prices in dollars, with a currency switch
- Every price shows in **US dollars** by default, wherever people connect from. A small currency pill in the top bar (USD, EUR, GBP, NGN and more) converts every price on the page: budget, hotels, flights, exports and the wallet. The wallet's own switch is the same choice.
- Prices keep their own currency underneath and are converted for display with the day's rates (`/api/fx`).
- Tests: conversion and formatting (web 43).

### Trips sync to your calendar
- The **Calendar** menu offers **Google Calendar**, **Apple or Outlook**, or **Download file**. Signed in, Google and Apple/Outlook subscribe once to a private Backline calendar; every trip you plan after that appears by itself, and updated plans replace the old events.
- The link is signed for one person (HMAC with the server key), so it can't be guessed or forged. Nothing new is stored: the feed reads the trips already saved to the account (`/api/calendar`, `/api/calendar/feed/<token>.ics`).
- Tests: signed links, events and durations, newest plan per trip (web 41).

### Send the plan anywhere
- A **Send** button next to Calendar, PDF and the rest opens a small menu: **WhatsApp**, **Telegram** or **Email me**. The whole plan goes as one message: the title, every day hour by hour, the budget and tips.
- WhatsApp and Telegram open with the message ready, so you can send it to yourself or to whoever you're travelling with.
- **Email me** sends it to the address you signed in with, and only that address, so it can't be used to email anyone else (5 a day per person). Signed out, your own email app opens with the plan instead.
- Tests: the message builder and share links (web 37).

## 2026-10-30 to 2026-10-31

### Plans that match what was asked
- Trips of any length: up to three years of dates, planned day by day. The first week is written with the summary, budget and tips; further weeks are written in parallel and the rest a week at a time (`/api/mission/week`).
- Dates and times read on the calendar (`when.ts`): explicit dates and ranges in any format, today/tonight/tomorrow, weekdays, weekends, "in 3 weeks", early/mid/late months, holidays (Easter computed), and times like "half past 7". Wrong weekdays are flagged; ambiguous dates are read day first (month first in the US), and said.
- The stated length and dates are pinned on every plan and update. A day trip or one evening has no hotel; "Dinner for 2 on Saturday at 8pm" plans that one dinner.
- "Affordable" and "luxury" set the price level, and the hotel booked must fit it. Children are read with their ages and sent to the hotel search.
- "Somewhere warm" or "surprise me" offers three fitting destinations to tap. A country trip is based in its main city, and the trip book says so.
- Every day is checked for timing: each item starts after the one before ends plus the journey between them.
- Different restaurants for each meal; hotels and resorts stay out of restaurants and things to do; the trip never moves to where the person travels from.

### What's on
- Events, concerts and festivals during the trip, found in listings for the exact dates, ranked by Qloo taste fit and scheduled into the plan; only good fits at known venues in the city itself. Ticket links on the payment slip; a What's on tab in the field guide.

### Reliability
- Backup AI providers (`LLM2_*`, `LLM3_*`) take over when the first is out of credit, refused or timing out.
- Health check at `/api/health`; a private monitor at `/ops` for accounts in `ADMIN_EMAILS` (services, settings, usage, recent missions, masked warnings).
- The planner forgives small model slips and mends broken JSON before giving up; template days are rewritten when the model is free again.
- Research timeouts with real aborts; one slow routing server no longer fails every route; error boundaries and honest failure states with Try again.

### The way in
- One continuous flight: the globe opens over the viewer's own region, turns home and flies once; the camera rides with the plane, pulls back at cruise and closes in on approach, with a contrail and pulses on take-off and touch-down.
- Seamless loading: the city title from the first frame, a steady progress bar, the map framed on the city, nothing overlapping on phones.

### Security and sign-in
- A cross-site request guard, stronger headers, a security page, and protection shown at payment.
- Demo calls only ring your own number; the Vapi webhook checks a secret; the site checker is IPv6-safe; call status only for its owner.
- Google sign-in names Backline's own site (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); sign-in by email link.
- Wallet fails closed when unreachable; held money is released on errors.

### Tests
- 409 engine tests and 33 web tests pass.

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
