# Third-party services

What each outside service does, what it receives, and what happens when it's missing or down. Nothing here is required to start the app except an AI model; every other service degrades to something honest instead of a guess.

| Service | Used for | Receives | Without it / when it fails | Env |
|---|---|---|---|---|
| **Qloo** | Taste profile, heatmap zone, taste-ranked places and events (the core of every pick) | The request's tastes and places | Map-only search; picks say they aren't taste-matched | `QLOO_API_KEY` |
| **AI models** (Anthropic, Nebius, Groq; any OpenAI-compatible) | The ReAct agent, understanding the request, writing the plan | The request and tool results; personal details only when a booking or call needs them | Next provider in `LLM_*` → `LLM2_*` → `LLM3_*`; if all fail, the autopilot finishes with the same tools | `LLM_*`, `LLM2_*`, `LLM3_*` |
| **SerpApi (Google Flights)** | Real fares for the dates and travellers | Airports, dates, number of travellers | A fare listed online, else a distance estimate, tagged "est." on the slip | `SERPAPI_API_KEY` |
| **Duffel** | Airline offers and booking | Route, dates; traveller and passport details at booking | Google Flights fares only; `BOOKING_LIVE` unset means price-only | `DUFFEL_API_KEY` |
| **LiteAPI** | Live hotel rates and booking | Destination, dates, guests; traveller at booking | Rates listed online, labelled; estimates labelled | `LITEAPI_API_KEY` |
| **OpenStreetMap** (Nominatim, Overpass, OSRM) | Geocoding, places, road routes | Place names and coordinates | Three Overpass mirrors and two routing servers race; straight lines between stops as a last resort | — |
| **TomTom Traffic** | Live traffic flow on the city's roads | Map tile requests from the browser | No Live traffic switch | `NEXT_PUBLIC_TOMTOM_KEY` |
| **Google Map Tiles** | Photoreal 3D city | Map tile requests from the browser | Satellite with terrain and 3D buildings | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` |
| **Tavily / Wikimedia / Claude search** | Web research, events, listed prices | Research questions (no personal details) | Wikivoyage fallback; a failing search is switched off for the run | `TAVILY_API_KEY`, `ANTHROPIC_API_KEY` |
| **Supabase** | Accounts, trips, memories, wallet ledger | Account data (row-level security) | Works signed out; details stay in the browser | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_*` |
| **Vapi + Telnyx** | AI phone calls (outbound, inbound, browser) | Business number, the person's name, the call brief | The agent writes the call script for the person | `VAPI_*` |
| **Resend** | Emails to businesses and to the person | Recipient, name, message | Email drafts to send yourself | `RESEND_API_KEY` |
| **Persona** | Identity checks before paid bookings | Handled in Persona's own flow | Paid bookings wait; demo continues | `PERSONA_*` |
| **Groq (speech-to-text)** | Voice prompt | The voice clip (not stored) | Type instead | `STT_*` |
| **Open-Meteo, Nager.Date, exchange rates** | Weather, holidays, currency | City and dates | Field guide shows what's missing | — |
| **Vercel** | Hosting | — | — | — |

Adding a service: list it here and in `SECURITY.md` and the privacy notice (`apps/web/src/app/privacy/page.tsx`), give it a timeout, and decide what the person sees when it's down.
