# Backline

**Say where. It researches, plans, calls and books — then shows you the whole trip on the real Earth.**

One sentence in ("a weekend in Lisbon for two, we love fado"). Out comes a taste-matched trip, researched from cited sources, flown through in 3D, and — on one tap of approval — booked: real AI phone calls to hotels and restaurants, payments, and confirmation numbers, live on screen.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Live at **[backline-beta-one.vercel.app](https://backline-beta-one.vercel.app)**.

## The core loop

| # | Step | How | What you see |
|---|---|---|---|
| 1 | **Understand** | Nemotron (Nebius) reads the request; dates resolved on the calendar; origin from what you said, your home city, or your connection | The globe flies to your destination within seconds, from your city |
| 2 | **Taste** | Qloo resolves what you love to entities and tags, and maps where that taste lives in the city (heatmap, taste zone) | Qloo's taste rises over the real city as glowing columns; "Because you love …" |
| 3 | **Research** | A ReAct agent searches Qloo places, OpenStreetMap, live hotel rates, web sources; field guide from Open-Meteo, holidays, exchange rates, cited notes | Pins drop onto real streets; every pick shows its Qloo affinity and rank |
| 4 | **Plan** | Hour-by-hour plan using only listed places; real road routes | Day routes drawn on the streets; "Fly the trip" plays each day |
| 5 | **Approve** | One checkpoint, one button | "Here's what I'll do. Good to go?" |
| 6 | **Execute** | Real Vapi voice calls; hotel and flight booking with payment (test mode in the demo); emails | A live Bookings panel: phones ringing, transcripts, receipts with confirmation numbers |

The rules that keep it honest are written down as a specification: **[docs/SYSTEM.md](docs/SYSTEM.md)**. Every live check we ran, what was wrong and how it was fixed: **[docs/VERIFICATION.md](docs/VERIFICATION.md)**.

## What is real, and what is test mode

| Capability | In the live demo | Notes |
|---|---|---|
| Qloo taste, heatmap, places, affinity | **Real** | Qloo's own scores, shown to three decimals with rank |
| Research, routes, weather, holidays, exchange rates | **Real**, cited | Nothing is estimated; gaps are listed |
| AI phone calls (Vapi + Telnyx numbers) | **Real calls** | With `CALL_DEMO_TO` set, calls ring a demo line where a person plays the business |
| Hotel booking and payment (LiteAPI) | **Real API, test mode** | Real booking reference; "Test mode · no money moved" |
| Flight booking (Duffel) | **Real API, test airline** | Test fares are never shown as prices |
| Emails to businesses (Resend) | **Real** when signed in | Within per-mission limits |
| 3D city | Satellite + terrain + 3D buildings; **Photoreal (Google 3D Tiles)** when a key is set | |

## The expedition

Trips open into a full-screen expedition on the real Earth (MapLibre GL globe, satellite imagery, terrain, 3D buildings) with a Three.js layer sharing the camera: light beacons over every pick, Qloo taste columns, trees grown in real parks, clouds and rain from the forecast, a traveller that flies each day's route. A colour grade follows the hour and the weather; drag the day's clock to see the light change. Light and dark themes. Details: [docs/EXPERIENCE.md](docs/EXPERIENCE.md).

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
| `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_MODEL` | Outbound AI phone calls through Vapi (imported Telnyx number). Without them the agent writes the call script for you |
| `CALL_DEMO_TO` | Demo line (E.164). When set, every booking call rings this number instead of the business |
| `PERSONA_API_KEY`, `NEXT_PUBLIC_PERSONA_TEMPLATE_ID`, `NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID` | Identity checks with Persona; paid bookings wait for a verified traveller |
| `CALLS_LIVE` | `1` lets AI calls reach real businesses. Off by default: without it and without a demo line, no business is ever dialled |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Optional Photoreal mode: Google Photorealistic 3D Tiles (Map Tiles API), restricted by website |
| `UBER_CLIENT_ID`, `UBER_CLIENT_SECRET`, `UBER_SCOPE`, `UBER_ENV` | Optional live Uber price estimates. Used only when `UBER_ENV=production`; otherwise ride fares come from published rates |
| `NEXT_PUBLIC_MAP_TILES`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | Optional keyed map tile provider (OpenStreetMap by default) |
| `SUPABASE_URL` | Same project URL, read on the server |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` | Public site URL and privacy contact |

## Documentation

- **[System specification](docs/SYSTEM.md)** — definitions, lifecycle, sources, accuracy policy, consent, calls, payments, data, failure modes
- **[Verification log](docs/VERIFICATION.md)** — live checks against independent sources, findings and fixes
- **[Expedition design](docs/EXPERIENCE.md)** — the 3D experience, design system, motion and the research behind it
- **[Changelog](docs/CHANGELOG.md)**
- [Product requirements](docs/PRD.md)
- [Feature specifications](docs/FEATURES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](SECURITY.md)
- [Qloo API notes](docs/qloo-api-notes.md)
- [Quality assurance](docs/QA.md)
- [Roadmap](docs/ROADMAP.md)

## Credits and data

- Taste data by [Qloo](https://qloo.com).
- Maps © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors via OpenFreeMap; satellite imagery © Esri, Maxar, Earthstar Geographics; terrain from AWS Terrain Tiles; Photoreal 3D © Google (when enabled); routing by OSRM; geocoding by Nominatim and Photon.
- Travel text from Wikivoyage and Wikipedia (CC BY-SA) when used as a fallback.
- Ride fares are estimates from published rates; final fares are set by the ride app.
- Qloo API responses are never stored in this repository; tests use synthetic data.

## License

[MIT](LICENSE)
