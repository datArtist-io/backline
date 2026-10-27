# Quality assurance

## Automated

| Layer | Command | What it covers |
|---|---|---|
| Types | `npm run typecheck` | TypeScript strict across the engine and the web app |
| Unit | `npm test` (engine 283, web 25) | Every engine skill and helper with stubbed clients: request parsing and grounding, the taste profile (tags, audience, heatmap zone, match), place search and merging, hotel lanes and prices, rides and routes, the agent loop and its fallbacks, documents, follow-ups, the artist missions |
| Live APIs | `npm run check` | Keys work; Qloo endpoints, entity types and heatmaps answer as expected; web research and the model respond |
| Coverage | `npm run check:locations`, `npm run check:places` | Geocoding and place coverage across 24 cities |

All test data is synthetic. Qloo responses are never committed.

## Manual checks before a release

Run each with `?debug=1` to see every model call, web call and agent decision.

1. **Taste trip:** "Weekend in Lagos Nov 14 to 16, I love Wizkid and jazz". Expect the taste card (Wizkid as an artist, jazz as a genre), the heatmap and zone on the map, hotels searched around the zone, match rings on the cards.
2. **Celebrity plan:** "Plan a weekend in Lagos like Burna Boy would". Expect "Planned like Burna Boy" and no invented landmark.
3. **Event near a landmark:** "Hotel near the National Theatre in Lagos for the 28th". Expect searches around the theatre and the closest lane.
4. **Hosting:** "Birthday dinner for 12 in Lekki next Saturday". Expect a venue and restaurants, no hotel unless asked.
5. **No taste given:** "Plan a weekend in Accra". Expect the invitation to add what they love, and a plan that still works.
6. **Exports:** calendar, PDF, Word, PowerPoint and slides open and include the taste profile.
7. **Phone width:** the taste card, lanes and map fit at 375 px.
8. **Checkout:** "Weekend in Lisbon for 2, we love fado and seafood" signed in. Expect the checkout to open by itself with every booking, the total in your currency and the wallet after; "Take a look first" returns to the trip.
9. **Execution:** approve. Expect each booking prepaid (wallet entries with receipts), calls ringing your phone one at a time, a refund on a booking no place could take, and every receipt opening at `/receipt/<id>`.
10. **Wallet:** turn the card over, switch currency, add a custom amount, filter activity, open a payment.
11. **Identity:** Account → Wallet & ID shows the Persona section (disabled until keys are set).

Also run `next build` before a release; it type-checks the app and every route.

## Definition of done

- Types and tests pass.
- New logic has unit tests.
- Empty, loading and error states are handled.
- Focus is visible, controls are labelled, motion respects reduced-motion settings.
- Docs match the behaviour.
