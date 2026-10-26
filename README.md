# Backline

**Plan anything outside your home, from one sentence.** Trips, events, birthday dinners, nights out, a weekend styled after your favourite artist. Tell Backline what you're planning, where and when. Its agent finds the places through Qloo's taste graph, checks real prices, maps every move with ride fares between stops, writes the plan and books it with you.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) during the submission period (September 30 to October 30, 2026).

## How it uses Qloo

Taste comes first. Before anything is searched, Backline reads the person's taste through Qloo, and every step after that uses it:

- **Taste profile:** the artists, films, places, genres or cuisines they mention (or a celebrity they want to plan like) are resolved to Qloo entities and tags. Qloo's tag insights give the vibe, the scenes and the dishes that go with that taste; demographics give the age group that shares it; artist and brand insights give what those fans also love.
- **Where the taste lives:** Qloo's heatmap for the destination shows where in the city that taste is concentrated. The strongest cluster becomes the taste zone. It's drawn on the map, and when there's no fixed venue, hotels, food and things to do are searched there first.
- **Taste-matched places:** hotels, restaurants, venues and things to do come from Qloo Insights (`urn:entity:place`) with the taste as the signal, merged with OpenStreetMap for coordinates and contacts. Each place's affinity rank becomes a taste match shown on its card and used to choose.
- **Plans that explain themselves:** the plan is written around the best matches and says how it fits the person's taste ("Loved by fans of Burna Boy").
- **Artist missions:** for artist teams, Qloo's audience and demographic data drive fan profiles, brand matches and tour routing.

## What it does

- **One sentence in, a full plan out:** the agent (a ReAct loop on NVIDIA Nemotron via Nebius) decides which searches to run, checks its own coverage and stops when the plan is complete.
- **Hotels in four lanes:** Premium, Closest, Best value and Lowest price. It searches 5 km around where you need to be, plus the best-rated hotels within 10 km. Prices are only shown when they are really listed for your dates, with a link to the page; nothing is estimated.
- **Getting around:** routes between every stop on a live map, ride fares at published rates with a one-tap ride link, walking for short hops, and a round-trip view from your home city.
- **Plan like your favourite celebrity:** "a weekend in Lagos like Burna Boy would" uses that artist's Qloo taste to pick places.
- **Live research:** current prices, opening times and events from the web, with sources.
- **Take it with you:** add the whole plan to your calendar (.ics), export a PDF, a Word document or a PowerPoint deck, or present it as slides in the browser.
- **Documents:** attach a ticket, booking or itinerary (PDF, image, spreadsheet) and the agent plans around it.
- **Books and pays for you:** with a booking provider connected, the agent books the hotel and pays for it, only at the price you approved and within your budget, and the confirmation is emailed to you. Card details never pass through Backline. Restaurants and venues are booked by email or phone call, and calls say they're from an AI assistant.

## Try it

Open the demo at **[backline-beta-one.vercel.app](https://backline-beta-one.vercel.app)** and type something like:

- `Weekend in Lagos for a show at the National Theatre, Nov 14 to 16`
- `Plan a weekend in Lagos like Burna Boy would`
- `Birthday dinner for 12 in Lekki next Saturday`

You can plan without signing in. Sign in (Google or an email link) to let it book, pay, email and call for you, and it keeps your traveller details, the tastes it has learned and every trip it booked, at `/account`.

## What's live in the demo

| Feature | Status |
|---|---|
| Taste profile, taste zone and taste-matched places (Qloo) | Live |
| Agent reasoning and plan writing (Nemotron on Nebius) | Live |
| Live web research with sources | Live |
| Hotels with real listed prices, flights, routes and ride-fare estimates | Live |
| Emailing plans and confirmations (Resend) | Live when signed in |
| Hotel and flight booking | Sandbox / test mode, so no real money moves |
| Outbound AI phone calls | Built, off in the public demo; the agent writes the call script instead |
| Live Uber prices | Built, off until Uber production approval; published-rate estimates are used |

## Repository

```
apps/web          Next.js app: landing page, brief view, API routes
packages/engine   Agent engine: skills, orchestrator, Qloo / LLM / Tavily clients, tests
packages/db       SQL migrations for Supabase
brand/            Logo marks and concept board
docs/             Product, architecture, security, QA and roadmap documents
scripts/          API and location coverage checks
```

## Getting started

Requires Node.js 20.3 or newer.

```bash
npm install                                  # installs all workspaces
cp .env.example apps/web/.env.local          # then fill in your keys
npm run check                                # verifies Qloo and the AI provider
npm run dev                                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Start the web app |
| `npm test` | Engine unit tests (synthetic data, no network) |
| `npm run typecheck` | Type-check every workspace |
| `npm run check` | Verify API keys and Qloo capabilities |
| `npm run check:locations` | Venue coverage across 24 locations worldwide |

### Environment variables (`apps/web/.env.local`)

| Variable | Purpose |
|---|---|
| `QLOO_API_KEY`, `QLOO_API_URL` | Qloo hackathon API |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MODEL_FAST`, `LLM_MODEL_STRONG` | Any OpenAI-compatible provider (Nebius Token Factory by default) |
| `TAVILY_API_KEY` | Live web research |
| `STT_API_KEY`, `STT_BASE_URL`, `STT_MODEL` | Speech-to-text for the voice prompt |
| `TRAVEL_DOCS_KEY` | Encrypts saved passports (AES-256-GCM); `openssl rand -base64 32` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Accounts: Google and email sign-in, saved details, trips and memory (run migration `0003_accounts.sql`; see `docs/SETUP-AUTH.md`) |
| `ANTHROPIC_API_KEY`, `CLAUDE_SEARCH_MODEL` | Web research and listed hotel prices; Tavily also supported, with Wikivoyage as a free fallback |
| `DUFFEL_API_KEY` | Flight search, booking and payment (a `duffel_test_` token uses Duffel's test airline) |
| `LITEAPI_API_KEY` | Live hotel rates, booking and payment (a `sand_` key simulates payment) |
| `RESEND_API_KEY`, `ACTIONS_FROM_EMAIL` | Emails the agent sends for you (plans, confirmations, restaurant requests); sender must be on a domain verified in Resend |
| `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_MODEL` | Optional outbound AI phone calls through Vapi (needs an imported Twilio, Vonage or Telnyx number). Without them the agent writes the call script for you |
| `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_SCOPE`, `UBER_ENV` | Optional live Uber price estimates. Used only when `UBER_ENV=production`; otherwise ride fares come from published rates |
| `NEXT_PUBLIC_MAP_TILES`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | Optional keyed map tile provider (OpenStreetMap by default) |
| `SUPABASE_URL` | Same project URL, read on the server |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` | Public site URL and privacy contact |

## Documentation

- [Product requirements](docs/PRD.md)
- [Feature specifications](docs/FEATURES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Qloo API notes](docs/qloo-api-notes.md)
- [Quality assurance](docs/QA.md)
- [Roadmap](docs/ROADMAP.md)

## Credits and data

- Taste data by [Qloo](https://qloo.com).
- Maps © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors; routing by OSRM; geocoding by Nominatim and Photon.
- Travel text from Wikivoyage and Wikipedia (CC BY-SA) when used as a fallback.
- Ride fares are estimates from published rates; final fares are set by the ride app.
- Qloo API responses are never stored in this repository; tests use synthetic data.

## License

[MIT](LICENSE)
