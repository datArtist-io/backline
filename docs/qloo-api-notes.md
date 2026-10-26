# Qloo hackathon API: rules we follow

Source: Qloo Agentic Hackathon Developer Guide (docs.qloo.com).

- **Base URL:** `https://hackathon.api.qloo.com` only. Staging/production URLs return 401 with a hackathon key.
- **Auth:** `X-Api-Key` header. Not a query param, not Bearer.
- **Method:** `/v2/insights` and `/search` are GET with query-string params. No JSON bodies.
- **Endpoints:** use `/search` (names → entity IDs), `/v2/tags` (keywords → tag IDs), `/v2/insights` (recommendations). Never `/recommendations` or `/recs` (legacy, unsupported).
- **`filter.type` values for Insights:** `urn:entity:artist`, `book`, `brand`, `destination`, `movie`, `person`, `place`, `podcast`, `tv_show`, `video_game`. A 403 means the type isn't supported. Music is `artist`; food/drink is `place` or `brand`.
- **`/search` types differ** from Insights `filter.type` values.
- **Invalid params are silently ignored.** A 200 with empty entities usually means a param isn't valid for that `filter.type` (check the Entity Type Parameter Guide), or there's no data for that entity/region.
- **Tags and audiences need real IDs** (from `/v2/tags` / audience URNs), never free text.
- **Data coverage may be thin for some regions** (e.g. Lagos places). Always handle empty results gracefully.
- **Caching:** private server-side caching is allowed, with no time limit. **Never commit Qloo response data to the public repo.**
- **Quota:** generous; ask in Discord `#api-help` if we hit limits. Keys stop working after judging ends.
- **Help:** Qloo Hackathon Discord, `#api-help`.

## Verified behaviour (Oct 22, `npm run check`)

- `/search` without `types` can return the **person** entity for an artist name; insights still work with that ID. Prefer `types=urn:entity:artist` when resolving artists.
- Supported `filter.type` values confirmed: artist, brand, movie, tv_show, book, podcast, destination, place, plus `urn:tag`, `urn:demographics`, `urn:heatmap`. **`urn:entity:video_game` returns 400.**
- `urn:tag` insights return tags from every domain; filter by tag type for usable themes.
- `urn:demographics` returns `query.age` (six bands) and `query.gender` as indices from −1 to 1.
- `urn:heatmap` returns `results.heatmap[]` of `{ location: {lat, lon, geohash}, query: {affinity…} }`.
- Destinations and places include `location {lat, lon, geohash}`.
- Artist entities include rich properties such as `adjectives_for_fans`, `lyrical_themes`, `characteristics`, `primary_genres`, `associated_brands`.
- Brand entities include `known_partnerships`, `key_markets`, `target_age_group`, `market_positioning`, `official_site`.
- `signal.demographics.age` and `signal.location.query` change results; `filter.location.query` works for Lagos and London.
- Music venue tag: `urn:tag:setting:qloo:music_venue`.
- Insights latency: roughly 0.3–3 s per call.
- `urn:tag` insights accept `filter.tag.types` (for example `urn:tag:style:qloo`, `urn:tag:genre:place`, `urn:tag:specialty_dish:place`, `urn:tag:cost_description:place`) to return only those kinds of tag.
- `signal.interests.tags` works for places, heatmaps, tags and demographics, so a genre ("jazz") can be a taste signal on its own.
- Heatmap points use `location.latitude` / `location.longitude` with a 6-character geohash, and include `query.popularity` alongside `query.affinity`. A city returns over a thousand points.
- Place affinities for one taste sit close together (around 0.97 to 0.98), so ranking matters more than the raw value.
