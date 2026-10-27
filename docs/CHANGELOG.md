# Changelog

## 2026-10-27

### Execution
- Bookings panel inside the expedition: live call status and transcripts, receipts with confirmation numbers, test-mode labels.
- `CALL_DEMO_TO` demo line: real AI calls ring a number where a person plays the business.
- Sandbox hotel rates restored for test-mode book-and-pay, labelled everywhere and never shown as prices.

### Accuracy
- Qloo affinity shown as Qloo's own score with rank, not rank-as-percent.
- Weekends resolved on the calendar; no dates → coming long weekend, stated.
- Origin always known: stated, home city, or connection city, stated.
- Planner sees each place's kind; no doubled names; no unconfirmed events; no invented arrival times.
- "Getting there" research from route planners, fare and journey-time pages; fare and time on the flight arc.
- Test-airline fares never surfaced.
- Taste never empty: with no likes given, the destination is read through Qloo (what people who love it go for), and the trip says so.

### Experience
- Full-screen expedition on the real Earth (MapLibre globe, satellite, terrain, 3D buildings) with a Three.js layer: beacons, Qloo taste columns, trees, clouds, rain, sunlight, traveller.
- Optional Photoreal mode with Google Photorealistic 3D Tiles.
- Cinematic grade by hour and weather, tilt-shift, time-of-day scrubber, light and dark themes, deep-space backdrop.
- Landing-page design language: glass, pills, sheen title, sliding segmented control; animated icons; 2×2 facts.
- Worldwide defaults; Lisbon sample trip with coordinates checked against OpenStreetMap.
- Faster: destination read from the sentence, tiles preconnected, no tile cancellation while flying, lighter redraws.
