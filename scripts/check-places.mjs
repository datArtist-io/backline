// Shows what Qloo returns for hotels, restaurants and event venues in a few cities, so the
// planning agent's tag choices and fields can be checked against real data.
// Run with: npm run check:places   (prints names and field coverage only, never keys)
import { readFileSync } from "node:fs";

for (const path of ["apps/web/.env.local", ".env.local"]) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    break;
  } catch {}
}
const BASE = (process.env.QLOO_API_URL || "https://hackathon.api.qloo.com").replace(/\/$/, "");
const KEY = process.env.QLOO_API_KEY;
if (!KEY) {
  console.log("✗ QLOO_API_KEY missing in apps/web/.env.local");
  process.exit(1);
}
const get = async (path, params) => {
  const r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { "X-Api-Key": KEY } });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const list = (j, k) => (Array.isArray(j?.results) ? j.results : j?.results?.[k] ?? []);

for (const q of ["hotel", "restaurant", "event venue", "banquet hall", "music venue"]) {
  const { status, json } = await get("/v2/tags", { "filter.query": q, take: "8" });
  console.log(`\nTags for "${q}" (${status}):`);
  for (const t of list(json, "tags")) console.log("  -", t.name, "|", t.id || t.tag_id, "|", t.type || "");
}

for (const city of ["Lagos, Nigeria", "London", "Accra"]) {
  for (const [kind, tag] of [["hotel", "urn:tag:category:place:hotel"], ["restaurant", "urn:tag:category:place:restaurant"]]) {
    const { status, json } = await get("/v2/insights", { "filter.type": "urn:entity:place", "filter.location.query": city, "filter.tags": tag, take: "5" });
    const items = list(json, "entities");
    console.log(`\n${kind} in ${city} with ${tag} (${status}): ${items.length} results`);
    for (const e of items.slice(0, 5)) {
      const p = e.properties || {};
      console.log(`  - ${e.name} | phone:${p.phone ? "yes" : "no"} website:${p.website ? "yes" : "no"} price_level:${p.price_level ?? "-"} rating:${p.business_rating ?? "-"} | tags: ${(e.tags || []).slice(0, 3).map((t) => t.name).join(", ")}`);
    }
    if (items[0]) console.log("  property keys:", Object.keys(items[0].properties || {}).join(", "));
  }
}
