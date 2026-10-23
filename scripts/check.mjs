// Checks that your Qloo, Nebius and (optional) Gemini keys work and shows the shape of the real responses.
// Run with: npm run check
// It never prints your keys.
import { readFileSync } from "node:fs";

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return true;
  } catch {
    return false;
  }
}

if (!loadEnv("apps/web/.env.local") && !loadEnv(".env.local")) {
  console.log("✗ No apps/web/.env.local file found. Create it first (see README).");
  process.exit(1);
}

const QLOO = (process.env.QLOO_API_URL || "https://hackathon.api.qloo.com").replace(/\/$/, "");
const QKEY = process.env.QLOO_API_KEY || "";
const NBASE = (process.env.LLM_BASE_URL || process.env.NEBIUS_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const NKEY = process.env.LLM_API_KEY || process.env.NEBIUS_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "";

const short = (v, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + "…" : s;
};

async function qloo(path, params) {
  const url = `${QLOO}${path}?${new URLSearchParams(params)}`;
  const t = Date.now();
  const res = await fetch(url, { headers: { "X-Api-Key": QKEY, Accept: "application/json" } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ms: Date.now() - t, json, text };
}

function describeEntity(e) {
  if (!e || typeof e !== "object") return short(e);
  return {
    keys: Object.keys(e).join(", "),
    name: e.name,
    id: e.entity_id || e.id,
    types: e.types || e.type || e.subtype,
    affinity: e.query?.affinity,
    popularity: e.popularity,
    propertyKeys: e.properties ? Object.keys(e.properties).join(", ") : undefined,
    image: short(e.properties?.image, 120),
  };
}

function firstList(json, key) {
  const r = json?.results;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r[key])) return r[key];
  if (r && typeof r === "object") {
    for (const v of Object.values(r)) if (Array.isArray(v)) return v;
  }
  return [];
}

let ok = true;
const section = (t) => console.log(`\n──── ${t} ────`);

section("1. Qloo search");
if (!QKEY) {
  console.log("✗ QLOO_API_KEY is empty in .env.local");
  ok = false;
} else {
  const s = await qloo("/search", { query: "Burna Boy", take: "3" });
  console.log(`status ${s.status} in ${s.ms}ms`);
  if (s.status !== 200) {
    console.log("body:", short(s.text, 400));
    ok = false;
  } else {
    console.log("top-level keys:", Object.keys(s.json || {}).join(", "));
    const list = firstList(s.json, "entities");
    console.log("results:", list.length);
    console.log("first:", describeEntity(list[0]));
    const id = list[0]?.entity_id || list[0]?.id;

    if (id) {
      for (const [label, type, extra] of [
        ["2. Insights: artists", "urn:entity:artist", {}],
        ["3. Insights: places in Lagos", "urn:entity:place", { "filter.location.query": "Lagos" }],
        ["4. Insights: movies", "urn:entity:movie", {}],
        ["5. Insights: brands", "urn:entity:brand", {}],
      ]) {
        section(label);
        const r = await qloo("/v2/insights", { "filter.type": type, "signal.interests.entities": id, take: "3", ...extra });
        console.log(`status ${r.status} in ${r.ms}ms`);
        if (r.status !== 200) { console.log("body:", short(r.text, 400)); continue; }
        const l = firstList(r.json, "entities");
        console.log("results:", l.length);
        l.slice(0, 2).forEach((e) => console.log(describeEntity(e)));
      }

      section("6. Insights: taste tags");
      const tg = await qloo("/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": id, take: "5" });
      console.log(`status ${tg.status} in ${tg.ms}ms`);
      if (tg.status === 200) firstList(tg.json, "tags").slice(0, 5).forEach((t) => console.log("-", t.name, "|", t.tag_id || t.id, "| affinity", t.query?.affinity));
      else console.log("body:", short(tg.text, 400));

      section("7. Insights: demographics");
      const dm = await qloo("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": id });
      console.log(`status ${dm.status} in ${dm.ms}ms`);
      if (dm.status === 200) console.log("first row:", short(firstList(dm.json, "demographics")[0], 400));
      else console.log("body:", short(dm.text, 400));

      // ---- Verifications needed by the feature specs (docs/FEATURES.md, items marked ⧗) ----
      const quick = async (label, params, key = "entities") => {
        section(label);
        const r = await qloo("/v2/insights", { "signal.interests.entities": id, take: "3", ...params });
        const l = r.status === 200 ? firstList(r.json, key) : [];
        console.log(`status ${r.status} in ${r.ms}ms, results: ${l.length}`);
        if (r.status !== 200) console.log("body:", short(r.text, 300));
        l.slice(0, 2).forEach((e) => console.log(describeEntity(e)));
        return { r, l };
      };

      for (const t of ["tv_show", "book", "podcast", "video_game", "destination"]) {
        await quick(`V1. Category: ${t}`, { "filter.type": `urn:entity:${t}` });
      }

      const young = await quick("V2. Age signal (24 and younger, brands)", { "filter.type": "urn:entity:brand", "signal.demographics.age": "24_and_younger" });
      const older = await quick("V2b. Age signal (35 to 44, brands)", { "filter.type": "urn:entity:brand", "signal.demographics.age": "35_to_44" });
      console.log("age bands give different top brand:", young.l[0]?.name !== older.l[0]?.name);

      await quick("V3. Location signal (London, artists)", { "filter.type": "urn:entity:artist", "signal.location.query": "London" });
      await quick("V4. Places filtered to London", { "filter.type": "urn:entity:place", "filter.location.query": "London" });

      const hm = await quick("V5. Heatmap (Nigeria)", { "filter.type": "urn:heatmap", "filter.location.query": "Nigeria" }, "heatmap");
      if (hm.r.status === 200) console.log("heatmap top-level result keys:", Object.keys(hm.r.json?.results || {}).join(", "));

      section("V6. Coordinates and tags on a destination");
      const d = await qloo("/v2/insights", { "filter.type": "urn:entity:destination", "signal.interests.entities": id, take: "1" });
      const dest = firstList(d.json, "entities")[0];
      console.log("location field:", short(dest?.location ?? dest?.properties?.geocode ?? dest?.properties?.location, 200));
      console.log("tags field (first 3):", short((dest?.tags || []).slice(0, 3), 300));

      section("V7. Tag search (music venue)");
      const ts = await qloo("/v2/tags", { "filter.query": "music venue", take: "3" });
      console.log(`status ${ts.status} in ${ts.ms}ms`);
      if (ts.status === 200) firstList(ts.json, "tags").slice(0, 3).forEach((t) => console.log("-", t.name, "|", t.id || t.tag_id));
      else console.log("body:", short(ts.text, 300));
    }
  }
}

section(`8. AI models available at ${NBASE.replace(/^https?:\/\//, "").split("/")[0]}`);
if (!NKEY) {
  console.log("✗ LLM_API_KEY is empty in .env.local");
  ok = false;
} else {
  const m = await fetch(`${NBASE}/models`, { headers: { Authorization: `Bearer ${NKEY}` } });
  console.log("status", m.status);
  if (m.ok) {
    const ids = ((await m.json()).data || []).map((x) => x.id);
    const chat = ids.filter((i) => !/whisper|tts|guard|embed|playai|orpheus|flux|sdxl|image/i.test(i));
    const nemo = chat.filter((i) => /nemotron/i.test(i));
    if (nemo.length) {
      console.log(`NVIDIA Nemotron models (${nemo.length}):`);
      nemo.forEach((i) => console.log("  ", i));
    }
    console.log(`Other chat models (${chat.length - nemo.length}, first 15):`);
    chat.filter((i) => !nemo.includes(i)).slice(0, 15).forEach((i) => console.log("  ", i));
    globalThis.__nemo = nemo;
  } else {
    console.log("body:", short(await m.text(), 300));
    ok = false;
  }

  section("9. AI test reply");
  const nemoPick = (globalThis.__nemo || []).find((i) => /super/i.test(i)) || (globalThis.__nemo || [])[0];
  const useModel = MODEL || nemoPick;
  if (!useModel) {
    console.log("✗ LLM_MODEL is empty. Copy one of the model IDs above into .env.local, then run this again.");
    ok = false;
  } else {
    if (!MODEL) console.log(`LLM_MODEL is empty, so testing with ${useModel}. If it works, set LLM_MODEL to it in .env.local.`);
    const t = Date.now();
    const r = await fetch(`${NBASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${NKEY}` },
      body: JSON.stringify({ model: useModel, max_tokens: 200, messages: [{ role: "user", content: 'Reply with only this JSON: {"hello":"world"}' }] }),
    });
    const text = await r.text();
    console.log(`status ${r.status} in ${Date.now() - t}ms`);
    try { console.log("reply:", short(JSON.parse(text).choices?.[0]?.message?.content, 300)); }
    catch { console.log("body:", short(text, 300)); ok = false; }
  }
}

// 10. Web research, hotel prices and document reading (optional): Claude with web search.
const AKEY = process.env.ANTHROPIC_API_KEY || "";
if (AKEY) {
  section("10. Web research, hotel prices and document reading (Claude)");
  const model = process.env.CLAUDE_SEARCH_MODEL || "claude-haiku-5-5";
  const t = Date.now();
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": AKEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "user", content: "Search the web: what's on at the National Theatre in Lagos this month? One short sentence with a source." }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }] }),
  });
  const text = await r.text();
  console.log(`${model}: status ${r.status} in ${Date.now() - t}ms`);
  try {
    const j = JSON.parse(text);
    if (!r.ok) throw new Error(j.error?.message || short(text, 300));
    const results = (j.content || []).filter((b) => b.type === "web_search_tool_result").flatMap((b) => (Array.isArray(b.content) ? b.content : []));
    console.log(`✓ Web search works: ${results.length} pages, e.g. ${results.slice(0, 2).map((x) => x.title).join(", ") || "(none)"}`);
  } catch (err) {
    console.log("✗", err.message || short(text, 300));
    ok = false;
  }
} else {
  section("10. Web research");
  console.log("ANTHROPIC_API_KEY isn't set, so research uses the free Wikivoyage and Wikipedia search, hotel prices aren't looked up and photos can't be read.");
}

// 11. Voice input key (speech-to-text).
{
  section("11. Voice input (speech-to-text)");
  const SKEY = process.env.STT_API_KEY || "";
  const SBASE = (process.env.STT_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  if (!SKEY) {
    console.log("✗ STT_API_KEY is empty, so the mic can't transcribe.");
    ok = false;
  } else {
    const r = await fetch(`${SBASE}/models`, { headers: { Authorization: `Bearer ${SKEY}` } });
    const j = await r.json().catch(() => ({}));
    const want = process.env.STT_MODEL || "whisper-large-v3-turbo";
    const has = (j.data || []).some((m) => m.id === want);
    if (r.ok && has) console.log(`✓ Key works and ${want} is available.`);
    else {
      console.log(`✗ status ${r.status}${r.ok ? `, but ${want} isn't in the model list` : ""}.`);
      ok = false;
    }
  }
}

console.log(ok ? "\n✓ All checks passed." : "\n✗ Some checks failed. See the sections marked ✗ above.");
