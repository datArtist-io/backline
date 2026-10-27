# The Expedition — Experience and Design

The trip interface (`apps/web/src/app/adventure/*`). It replaces a feed of agent text with the trip itself, on the real Earth.

## 1. Principles

1.1 **The world is the hero.** Real imagery and geography fill the screen; the interface is glass over it.
1.2 **No model monologue.** Progress is shown as named chapters (Taste → Getting there → Places → Plan → Routes → Field guide → Bookings), never as streamed model text.
1.3 **Qloo is the reason for every pick.** The taste panel, the taste columns over the city, the affinity and rank on every place.
1.4 **Honest by design.** Test-mode labels, cited sources, "Not listed" instead of guesses (see `SYSTEM.md §5`).
1.5 **One product.** The same materials as the landing page: liquid glass, pills, the violet → pink sheen, Unbounded and Hanken Grotesk.

## 2. Sequence

| Moment | What happens |
|---|---|
| 0–2 s | Deep space with a twinkling starfield and a brand nebula; the globe; "Planning / your trip." |
| 1–3 s | The destination is read from the sentence and geocoded; the title becomes the city |
| Taste ready | Qloo's taste rises over the city as columns and a heat glow; the taste panel appears |
| Travel ready | If home is far away, the camera replays the journey along a great-circle arc labelled with the cited fare and flight time |
| Places ready | Pins drop onto real streets with 3D beacons; labels declutter by Qloo rank |
| Plan ready | Day routes drawn on real roads; the dock offers "Fly the trip" |
| Approval | One checkpoint; "Do it" |
| Execution | The Bookings panel opens by itself: phones ring, transcripts arrive, receipts land |

## 3. World rendering

- **MapLibre GL 5** globe projection; Esri World Imagery; AWS Terrain Tiles with hillshade; OpenFreeMap vector data for roads, place names and 3D buildings (OSM `render_height`, `colour`).
- **Three.js custom layer** sharing MapLibre's camera and depth buffer: beacons (additive shader beams), Qloo taste columns (instanced hex prisms), a traveller with a light trail, trees grown from OSM parks and woods (deterministic per polygon), clouds, rain and snow from the forecast, hemisphere and sun lights from the hour.
- **Photoreal (optional):** Google Photorealistic 3D Tiles through `3d-tiles-renderer` as a second custom layer; Draco glTF; tiles fade in; the ground under the camera is probed so pins sit on the real surface.
- **Accuracy of placement:** a mercator-exact local frame re-anchored under the camera (`SYSTEM.md §4.3`).
- **Performance:** redraws at full rate only while something moves; 15 fps otherwise; device pixel ratio capped at 1.5; tiles preconnected and not cancelled while flying.

## 4. Art direction

- **Grade by hour and weather** (`gradeVars`): saturation, contrast, warmth and haze change for golden hour, night, rain and fog, with a soft vignette — the way games colour-grade a scene.
- **Tilt-shift** at street level and while flying, for the miniature, diorama feel.
- **Time of day** scrubber (after Google Maps Immersive View): drag the clock; sky, sun, lights and weather follow the forecast.
- **Light and dark** themes; system default, switch in the View menu.

## 5. Interface components

| Component | Notes |
|---|---|
| Title | City name in Unbounded with the brand sheen |
| Score | Average Qloo affinity of the picks (dial), places, days, km |
| Weather | Forecast for the day; opens the time-of-day scrubber |
| Taste panel | "Because you love …", Qloo's top pick per kind (affinity), vibes and dishes, taste zone, fans also love |
| Place card | Photo, kind, Qloo affinity and rank, why it fits, a 2×2 facts grid (rating, price, when, Qloo rank), address; Look around (Street View), Directions, Website |
| Dock | Fly the trip; days as a segmented control with a sliding thumb; View menu (whole trip, fly in again, Photoreal / Satellite / Painted, taste map, theme, classic view) |
| Bookings | Live status of every action, call status and transcript, receipts with confirmation numbers and test-mode labels |

## 6. Motion

Springs for things you touch (buttons lift and press, thumbs slide), ease-out for things that arrive (cards, chapters, pins dropping in), a sheen that sweeps across buttons on hover, icons with personality (the plane flies off and back, the fork wiggles, the compass needle spins). All motion respects `prefers-reduced-motion`.

## 7. Research behind the choices

- Google Maps Immersive View — the time slider over a 3D city with weather and light ([9to5Google](https://9to5google.com/2023/05/10/google-maps-immersive-view-routes/)).
- Mapbox Standard — dawn, day, dusk and night lighting; the city coming alive at night ([Mapbox](https://www.mapbox.com/blog/standard-core-style)).
- Apple Human Interface Guidelines for maps — keep the selected place visible beside its card, reduce detail when zoomed out, controls with a thin rim and soft shadow.
- Airbnb's 2025 redesign — icons with personality, scannable key facts, itineraries told in hours ([Design Week](https://www.designweek.co.uk/it-was-a-bit-nuts-teo-connor-on-designing-the-new-airbnb-app/)).
