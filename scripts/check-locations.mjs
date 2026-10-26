// Location coverage test: proves the venue search works worldwide, not just in a few cities.
// Run with: npm run check:locations   (never prints your keys)
import { readFileSync } from "node:fs";

for (const path of ["apps/web/.env.local", ".env.local"]) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
const BASE = (process.env.QLOO_API_URL || "https://hackathon.api.qloo.com").replace(/\/$/, "");
const KEY = process.env.QLOO_API_KEY;
if (!KEY) {
  console.log("✗ QLOO_API_KEY not found in apps/web/.env.local");
  process.exit(1);
}

const VENUE_TAG = "urn:tag:setting:qloo:music_venue";
const PLACES = [
  "Tokyo", "Seoul", "Mumbai", "Jakarta", "Dubai", "Cairo", "Nairobi", "Johannesburg", "Accra", "Kinshasa",
  "Paris", "Berlin", "Kraków", "London", "São Paulo", "Mexico City", "Buenos Aires", "Toronto", "Atlanta", "Sydney",
  "Auckland", "Ikeja, Lagos, Nigeria", "東京", "القاهرة",
];

async function insights(params) {
  const url = `${BASE}/v2/insights?${new URLSearchParams({ "filter.type": "urn:entity:place", take: "10", ...params })}`;
  const res = await fetch(url, { headers: { "X-Api-Key": KEY, Accept: "application/json" } });
  if (!res.ok) return { status: res.status, items: [] };
  const json = await res.json();
  return { status: 200, items: json?.results?.entities ?? [] };
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad("Location", 26)}${pad("Places", 9)}${pad("Venues", 9)}Sample`);
console.log("─".repeat(78));
let withPlaces = 0;
let withVenues = 0;
for (const place of PLACES) {
  const all = await insights({ "filter.location.query": place });
  const venues = await insights({ "filter.location.query": place, "filter.tags": VENUE_TAG });
  if (all.items.length) withPlaces++;
  if (venues.items.length) withVenues++;
  const sample = (venues.items[0] || all.items[0])?.name ?? (all.status !== 200 ? `HTTP ${all.status}` : "—");
  console.log(`${pad(place, 26)}${pad(all.items.length, 9)}${pad(venues.items.length, 9)}${String(sample).slice(0, 34)}`);
}

console.log("─".repeat(78));
console.log(`Places found in ${withPlaces}/${PLACES.length} locations; music venues in ${withVenues}/${PLACES.length}.`);

// Radius search (used when a small town has no data): does Qloo honour a point + radius?
const tokyo = { lat: 35.6895, lon: 139.6917 };
const near = await insights({ "filter.location": `POINT(${tokyo.lon} ${tokyo.lat})`, "filter.location.radius": "20000" });
const toRad = (d) => (d * Math.PI) / 180;
const km = (a, b) => {
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const inside = near.items.filter((p) => p.location && km(tokyo, p.location) <= 25).length;
console.log(`\nRadius search (20 km around Tokyo): status ${near.status}, ${near.items.length} results, ${inside} confirmed within range.`);
console.log(inside > 0 ? "✓ Radius search works: small places can widen to nearby areas." : "! Radius search returned nothing usable: small places will widen by region name instead.");
