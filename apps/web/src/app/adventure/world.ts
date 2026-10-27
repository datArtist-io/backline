// The game world's look: the real planet from OpenStreetMap (OpenFreeMap vector tiles), painted like
// a strategy game. Lush land, turquoise water, sandy paths, painted buildings, hillshaded relief.
// The sky and the sun follow the day's weather and the hour. Pure data and pure functions.
import type { ExpressionSpecification, LayerSpecification, LightSpecification, SkySpecification } from "maplibre-gl";

export const LAND = "#86c051";

const BUILDING_COLORS = ["#f7efdf", "#f2dab4", "#ecc596", "#f4e3a8", "#e4ecef", "#f2cdb8", "#efe2cf", "#dfe7d4"];

// Colour variety without a random function: OSM's own colour tag when it has one, else a palette
// picked by the building's height, so neighbouring buildings differ.
const buildingColor: ExpressionSpecification = [
  "to-color",
  ["coalesce", ["get", "colour"], ""],
  ["at", ["%", ["floor", ["*", ["coalesce", ["get", "render_height"], 9], 1.37]], BUILDING_COLORS.length], ["literal", BUILDING_COLORS]],
];

const z = (stops: [number, number][]): ExpressionSpecification => ["interpolate", ["exponential", 1.5], ["zoom"], ...stops.flat()] as ExpressionSpecification;

/** Vector layers, bottom to top. They go under the trip overlays. */
export const GAME_LAYERS: LayerSpecification[] = [
  {
    id: "g-landcover",
    type: "fill",
    source: "omt",
    "source-layer": "landcover",
    paint: {
      "fill-color": ["match", ["get", "class"], "wood", "#3f9441", "forest", "#3f9441", "grass", "#94cd59", "farmland", "#b8d26c", "scrub", "#7fb24f", "sand", "#f1dfa4", "rock", "#bdb8a4", "ice", "#f3f8ff", "wetland", "#6eb68a", "#8fc657"],
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 0.9],
      "fill-antialias": false,
    },
  },
  {
    id: "g-landuse",
    type: "fill",
    source: "omt",
    "source-layer": "landuse",
    paint: {
      "fill-color": ["match", ["get", "class"], "residential", "#a9cc72", "suburb", "#a9cc72", "neighbourhood", "#a9cc72", "commercial", "#c8cf8c", "retail", "#c8cf8c", "industrial", "#c4bf98", "railway", "#c4bf98", "cemetery", "#7ab866", "pitch", "#69bf55", "stadium", "#69bf55", "playground", "#9ad46a", "school", "#b5d47d", "university", "#b5d47d", "hospital", "#d6d39a", "quarry", "#cfc7a8", "#a3c96c"],
      "fill-opacity": 0.85,
    },
  },
  { id: "g-park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": "#6dbb45", "fill-opacity": 0.95 } },
  { id: "g-park-edge", type: "line", source: "omt", "source-layer": "park", minzoom: 13, paint: { "line-color": "#4e9a37", "line-width": 1.2, "line-opacity": 0.6 } },
  {
    id: "g-water",
    type: "fill",
    source: "omt",
    "source-layer": "water",
    paint: { "fill-color": ["interpolate", ["linear"], ["zoom"], 2, "#1d8fc2", 8, "#22a7cf", 13, "#33bfd4"], "fill-antialias": true },
  },
  // Foam where water meets land.
  { id: "g-shore", type: "line", source: "omt", "source-layer": "water", minzoom: 9, paint: { "line-color": "#bff4ee", "line-width": z([[9, 0.6], [14, 2.4], [17, 5]]), "line-blur": z([[9, 0.4], [16, 2.5]]), "line-opacity": 0.85 } },
  { id: "g-waterway", type: "line", source: "omt", "source-layer": "waterway", minzoom: 9, paint: { "line-color": "#38c2d4", "line-width": z([[9, 0.6], [15, 3], [18, 7]]) } },
  { id: "g-aeroway", type: "fill", source: "omt", "source-layer": "aeroway", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#cfd3c4", "fill-opacity": 0.9 } },
  { id: "g-runway", type: "line", source: "omt", "source-layer": "aeroway", filter: ["in", ["get", "class"], ["literal", ["runway", "taxiway"]]], paint: { "line-color": "#b4b8ad", "line-width": z([[10, 1], [15, 14], [18, 40]]) } },
  // Roads as warm sandy paths with a darker edge, the way game maps draw them.
  {
    id: "g-road-edge",
    type: "line",
    source: "omt",
    "source-layer": "transportation",
    minzoom: 10,
    filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#b4925a",
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, ["match", ["get", "class"], ["motorway", "trunk"], 2, ["primary", "secondary"], 1.4, 0.4], 18, ["match", ["get", "class"], ["motorway", "trunk"], 34, ["primary", "secondary"], 26, ["tertiary", "minor"], 18, 10]],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 13, 1],
    },
  },
  {
    id: "g-road",
    type: "line",
    source: "omt",
    "source-layer": "transportation",
    minzoom: 10,
    filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["match", ["get", "class"], ["motorway", "trunk"], "#fbe7b0", ["primary", "secondary"], "#f6e6bb", "#f1e3bf"],
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, ["match", ["get", "class"], ["motorway", "trunk"], 1.2, ["primary", "secondary"], 0.8, 0.2], 18, ["match", ["get", "class"], ["motorway", "trunk"], 28, ["primary", "secondary"], 21, ["tertiary", "minor"], 14, 7]],
    },
  },
  {
    id: "g-path",
    type: "line",
    source: "omt",
    "source-layer": "transportation",
    minzoom: 14,
    filter: ["in", ["get", "class"], ["literal", ["path", "track"]]],
    paint: { "line-color": "#e2c88c", "line-width": z([[14, 1], [18, 4]]), "line-dasharray": [2, 1.4] },
  },
  {
    id: "g-rail",
    type: "line",
    source: "omt",
    "source-layer": "transportation",
    minzoom: 12,
    filter: ["in", ["get", "class"], ["literal", ["rail", "transit"]]],
    paint: { "line-color": "#8a7a62", "line-width": z([[12, 0.8], [17, 3]]), "line-dasharray": [3, 2] },
  },
  {
    id: "g-buildings",
    type: "fill-extrusion",
    source: "omt",
    "source-layer": "building",
    minzoom: 13,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": buildingColor,
      "fill-extrusion-height": ["*", ["coalesce", ["get", "render_height"], 9], 1.08],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.96],
      "fill-extrusion-vertical-gradient": true,
    },
  },
  {
    id: "g-places",
    type: "symbol",
    source: "omt",
    "source-layer": "place",
    filter: ["in", ["get", "class"], ["literal", ["country", "city", "town", "suburb", "neighbourhood", "quarter"]]],
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": ["Noto Sans Bold"],
      "text-size": ["match", ["get", "class"], "country", 14, "city", 15, "town", 12.5, 11.5],
      "text-letter-spacing": 0.03,
      "text-max-width": 9,
    },
    paint: { "text-color": "#fffaf0", "text-halo-color": "rgba(40, 62, 24, 0.75)", "text-halo-width": 1.6 },
  },
];

// ---------- weather and light ----------

export type Sky = "clear" | "partly" | "cloudy" | "fog" | "rain" | "storm" | "snow";

/** WMO weather code (or the field guide's label) to the kind of sky to paint. Pure. */
export function skyKind(code: number | null | undefined, label?: string | null): Sky {
  const l = (label ?? "").toLowerCase();
  if (code != null) {
    if (code >= 95) return "storm";
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
    if (code === 45 || code === 48) return "fog";
    if (code === 3) return "cloudy";
    if (code === 2 || code === 1) return "partly";
    if (code === 0) return "clear";
  }
  if (/thunder|storm/.test(l)) return "storm";
  if (/snow|sleet/.test(l)) return "snow";
  if (/rain|shower|drizzle/.test(l)) return "rain";
  if (/fog|mist/.test(l)) return "fog";
  if (/overcast|cloudy/.test(l) && !/mostly clear|partly/.test(l)) return "cloudy";
  if (/partly|mostly/.test(l)) return "partly";
  return "clear";
}

/** How much cloud, rain and snow to draw (0–1). Pure. */
export function weatherMix(kind: Sky): { cloud: number; rain: number; snow: number; fog: number } {
  switch (kind) {
    case "clear":
      return { cloud: 0.12, rain: 0, snow: 0, fog: 0 };
    case "partly":
      return { cloud: 0.45, rain: 0, snow: 0, fog: 0 };
    case "cloudy":
      return { cloud: 0.85, rain: 0, snow: 0, fog: 0.2 };
    case "fog":
      return { cloud: 0.6, rain: 0, snow: 0, fog: 0.9 };
    case "rain":
      return { cloud: 0.9, rain: 0.7, snow: 0, fog: 0.3 };
    case "storm":
      return { cloud: 1, rain: 1, snow: 0, fog: 0.4 };
    case "snow":
      return { cloud: 0.85, rain: 0, snow: 0.8, fog: 0.3 };
  }
}

/** The sun at a local hour: daylight 0–1, and where it is (azimuth, elevation in degrees). Pure. */
export function sunAt(hour: number, lat: number): { day: number; azimuth: number; elevation: number } {
  const h = ((hour % 24) + 24) % 24;
  const noonHeight = Math.max(20, 90 - Math.abs(lat) - 10);
  const t = (h - 6.5) / 12.5; // sunrise ~6:30, sunset ~19:00
  const elevation = t <= 0 || t >= 1 ? -12 : Math.sin(t * Math.PI) * noonHeight;
  const day = Math.max(0, Math.min(1, (elevation + 6) / 18));
  // East in the morning, south (north in the southern hemisphere) at noon, west in the evening.
  const swing = lat >= 0 ? 90 + t * 180 : 90 - t * 180;
  return { day, azimuth: ((swing % 360) + 360) % 360, elevation };
}

const mix = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, "0")).join("")}`;
};

/** The sky for a kind of weather at an hour. Pure. */
export function skyFor(kind: Sky, hour: number, lat: number): SkySpecification {
  const { day, elevation } = sunAt(hour, lat);
  const w = weatherMix(kind);
  const golden = day > 0 && elevation < 14 ? 1 - Math.max(0, elevation) / 14 : 0;
  const clearSky = mix("#4fa9f0", "#f0a36a", golden * 0.55);
  const greySky = "#8b9aa8";
  const top = mix(mix("#0a1633", clearSky, day), mix("#0d1524", greySky, day), w.cloud * 0.8);
  const horizon = mix(mix("#1b2c52", mix("#d8f0ff", "#ffd6a0", golden), day), mix("#202838", "#c9d2da", day), w.cloud * 0.7);
  const fog = mix(mix("#14213d", "#e4f1fb", day), "#cfd6dc", w.fog * 0.6);
  return {
    "sky-color": top,
    "horizon-color": horizon,
    "fog-color": fog,
    "fog-ground-blend": 0.55 - w.fog * 0.35,
    "horizon-fog-blend": 0.5 + w.fog * 0.4,
    "sky-horizon-blend": 0.55,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 1, 10, 0.25, 12, 0],
  };
}

/** Light for the 3D buildings: warm and low at golden hour, cool and dim at night. Pure. */
export function lightFor(kind: Sky, hour: number, lat: number): LightSpecification {
  const s = sunAt(hour, lat);
  const w = weatherMix(kind);
  const golden = s.day > 0 && s.elevation < 14 ? 1 - Math.max(0, s.elevation) / 14 : 0;
  const color = s.day < 0.05 ? "#8fa6d8" : mix("#fffaf0", "#ffc98a", golden);
  return {
    anchor: "map",
    position: [1.4, s.azimuth, Math.max(20, Math.min(80, 90 - Math.max(0, s.elevation)))],
    color,
    intensity: Math.max(0.12, (0.55 - w.cloud * 0.2) * (0.35 + 0.65 * s.day)),
  };
}

/** How dark to tint the land at night and under heavy cloud (0 = full daylight). Pure. */
export function dusk(kind: Sky, hour: number, lat: number): number {
  const s = sunAt(hour, lat);
  const w = weatherMix(kind);
  return Math.min(0.72, (1 - s.day) * 0.66 + w.cloud * 0.12);
}

const REAL_BUILDINGS = ["#ece6da", "#ddd5c6", "#d2c8b6", "#e6dac4", "#c9c2b6", "#efe8dc", "#d9cbb3", "#c4beb2"];

/** The realistic look: satellite imagery underneath, with real 3D buildings, roads and names on top. */
export const REAL_LAYERS: LayerSpecification[] = [
  // A light tint deepens the satellite's water so seas and rivers read clearly.
  { id: "r-water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": "#1b8fb8", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.35, 12, 0.22, 16, 0.16] } },
  { id: "r-shore", type: "line", source: "omt", "source-layer": "water", minzoom: 11, paint: { "line-color": "#d6f7f2", "line-width": z([[11, 0.5], [16, 2]]), "line-blur": 1.5, "line-opacity": 0.45 } },
  {
    id: "r-road",
    type: "line",
    source: "omt",
    "source-layer": "transportation",
    minzoom: 12,
    filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary"]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fff6e2", "line-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.12, 16, 0.3], "line-width": z([[12, 0.6], [17, 6]]) },
  },
  {
    id: "r-buildings",
    type: "fill-extrusion",
    source: "omt",
    "source-layer": "building",
    minzoom: 13.5,
    filter: ["!=", ["get", "hide_3d"], true],
    paint: {
      "fill-extrusion-color": [
        "to-color",
        ["coalesce", ["get", "colour"], ""],
        ["at", ["%", ["floor", ["*", ["coalesce", ["get", "render_height"], 9], 1.37]], REAL_BUILDINGS.length], ["literal", REAL_BUILDINGS]],
      ],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 9],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0, 14.5, 0.92],
      "fill-extrusion-vertical-gradient": true,
    },
  },
  {
    id: "r-places",
    type: "symbol",
    source: "omt",
    "source-layer": "place",
    // From space the planet reads cleaner without names, as it does in Earth apps.
    minzoom: 4.5,
    filter: ["in", ["get", "class"], ["literal", ["country", "city", "town", "suburb", "neighbourhood", "quarter"]]],
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["match", ["get", "class"], "country", 13, "city", 14, "town", 12, 11],
      "text-letter-spacing": 0.03,
      "text-max-width": 9,
    },
    paint: { "text-color": "rgba(255,255,255,0.9)", "text-halo-color": "rgba(10,20,30,0.65)", "text-halo-width": 1.4 },
  },
];
