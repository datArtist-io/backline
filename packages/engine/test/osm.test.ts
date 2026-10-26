// Map client tests. All responses are synthetic.
import { describe, expect, it, vi } from "vitest";
import { OsmClient, decodePolyline, fromNominatim, fromOverpass, fromPhoton, hitKind, simplifyPath, spellingVariants } from "../src/clients/osm";

/** Google's polyline encoding, for building fixtures. */
function encode(points: [number, number][], precision = 6): string {
  const f = 10 ** precision;
  let out = "";
  let pLat = 0;
  let pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lat, lon] of points) {
    const a = Math.round(lat * f);
    const b = Math.round(lon * f);
    out += enc(a - pLat) + enc(b - pLon);
    pLat = a;
    pLon = b;
  }
  return out;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("spelling", () => {
  it("tries theatre/theater and centre/center, without a leading 'the'", () => {
    expect(spellingVariants("the national theater")).toEqual(["national theater", "national theatre"]);
    expect(spellingVariants("Eko Convention Center")).toEqual(["Eko Convention Center", "Eko Convention Centre"]);
    expect(spellingVariants("Lagos")).toEqual(["Lagos"]);
  });
});

describe("parsing map answers", () => {
  it("says what a hit is: a settlement's type, or a place's own type rather than 'building'", () => {
    expect(hitKind("city", "administrative", "boundary")).toBe("city");
    expect(hitKind("building", "train_station", "building")).toBe("train_station");
    expect(hitKind("amenity", "theatre", "amenity")).toBe("theatre");
    expect(hitKind("building", "yes", "building")).toBe("building");
    expect(hitKind(null, null, "railway")).toBe("railway");
    expect(fromNominatim([{ lat: "6.47", lon: "3.38", name: "Lagos Terminus", display_name: "Lagos Terminus, Iddo Road, Lagos", addresstype: "building", type: "train_station", category: "building" }])[0].kind).toBe("train_station");
  });

  it("reads Nominatim, Photon and Overpass safely", () => {
    const n = fromNominatim([{ lat: "6.455", lon: "3.394", name: "Lagos", display_name: "Lagos, Lagos State, Nigeria", addresstype: "city", importance: 0.71, address: { country: "Nigeria", country_code: "ng" } }, { lat: "x" }]);
    expect(n).toEqual([{ name: "Lagos", display: "Lagos, Lagos State, Nigeria", lat: 6.455, lon: 3.394, country: "Nigeria", countryCode: "NG", kind: "city", importance: 0.71, source: "nominatim" }]);
    const p = fromPhoton({ features: [{ geometry: { coordinates: [-8.67, 37.1] }, properties: { name: "Lagos", country: "Portugal", countrycode: "PT", osm_value: "town" } }] });
    expect(p[0]).toMatchObject({ name: "Lagos", lat: 37.1, lon: -8.67, countryCode: "PT", source: "photon" });
    const o = fromOverpass({
      elements: [
        { type: "node", id: 1, lat: 6.47, lon: 3.37, tags: { name: "Iganmu Suites", tourism: "hotel", stars: "4", phone: "+234 801 000 0000;+234 802", website: "javascript:alert(1)", email: "bad", "addr:street": "Iganmu Road", "addr:city": "Lagos" } },
        { type: "way", id: 2, center: { lat: 6.48, lon: 3.36 }, tags: { name: "Bukka Hut", amenity: "restaurant", cuisine: "nigerian;african", website: "www.bukkahut.example" } },
        { type: "node", id: 3, lat: 6.47, lon: 3.37, tags: { tourism: "hotel" } },
      ],
    });
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ id: "osm:n1", name: "Iganmu Suites", stars: 4, phone: "+234 801 000 0000", website: null, email: null, address: "Iganmu Road, Lagos", tags: ["Hotel", "4-star"] });
    expect(o[1]).toMatchObject({ id: "osm:w2", website: "https://www.bukkahut.example/", tags: ["Restaurant", "Nigerian cuisine", "African cuisine"] });
  });

  it("decodes polylines and simplifies long paths", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    const line: [number, number][] = Array.from({ length: 1000 }, (_, i) => [6 + i * 0.001, 3 + Math.sin(i / 50) * 0.01]);
    const s = simplifyPath(line, 120);
    expect(s.length).toBeLessThanOrEqual(120);
    expect(s[0]).toEqual(line[0]);
    expect(s[s.length - 1]).toEqual(line[999]);
  });
});

describe("OsmClient", () => {
  it("falls back from Nominatim (after spelling variants) to Photon, and caches", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("nominatim")) return json([]);
      return json({ features: [{ geometry: { coordinates: [3.368, 6.4757] }, properties: { name: "National Arts Theatre", country: "Nigeria", countrycode: "NG", osm_value: "theatre" } }] });
    });
    const osm = new OsmClient({ fetch: f as unknown as typeof fetch, minIntervalMs: 0 });
    const hits = await osm.geocode("national theater", { near: { lat: 6.455, lon: 3.394 }, radiusKm: 60 });
    expect(hits[0]).toMatchObject({ name: "National Arts Theatre", source: "photon" });
    expect(urls.filter((u) => u.includes("nominatim"))).toHaveLength(2);
    expect(urls.some((u) => u.includes("viewbox=") && u.includes("bounded=1"))).toBe(true);
    await osm.geocode("national theater", { near: { lat: 6.455, lon: 3.394 }, radiusKm: 60 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("drops hits outside the radius around a city", async () => {
    const f = vi.fn(async () => json([{ lat: "37.1", lon: "-8.67", name: "National Theatre", display_name: "National Theatre, Portugal", importance: 0.5 }]));
    const osm = new OsmClient({ fetch: f as unknown as typeof fetch, minIntervalMs: 0, photonUrl: "https://photon.example" });
    expect(await osm.geocode("National Theatre", { near: { lat: 6.455, lon: 3.394 }, radiusKm: 60 })).toEqual([]);
  });

  it("throws only when every geocoder fails", async () => {
    const f = vi.fn(async () => json({}, 503));
    const osm = new OsmClient({ fetch: f as unknown as typeof fetch, minIntervalMs: 0 });
    await expect(osm.geocode("Lagos")).rejects.toThrow("Map service returned 503");
  });

  it("finds nearby places, trying the next Overpass server on failure, nearest first", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("first")) return json({}, 504);
      expect(String(init?.body)).toContain("around%3A3000%2C6.47600%2C3.36800");
      return json({ elements: [
        { type: "node", id: 9, lat: 6.49, lon: 3.38, tags: { name: "Farther Inn", tourism: "hotel" } },
        { type: "node", id: 8, lat: 6.4765, lon: 3.3685, tags: { name: "Next Door Hotel", tourism: "hotel" } },
      ] });
    });
    const osm = new OsmClient({ fetch: f as unknown as typeof fetch, overpassUrls: ["https://first.example/api", "https://second.example/api"] });
    const places = await osm.nearby("stay", { lat: 6.476, lon: 3.368 }, 3000);
    expect(places.map((p) => p.name)).toEqual(["Next Door Hotel", "Farther Inn"]);
  });

  it("returns a road route with legs and a drawable path", async () => {
    const path: [number, number][] = [[6.45, 3.39], [6.46, 3.38], [6.476, 3.368]];
    const f = vi.fn(async (url: string) => {
      expect(url).toContain("/route/v1/driving/3.39000,6.45000;3.36800,6.47600?overview=full&geometries=polyline6");
      return json({ code: "Ok", routes: [{ distance: 4200, duration: 780, geometry: encode(path), legs: [{ distance: 4200, duration: 780 }] }] });
    });
    const osm = new OsmClient({ fetch: f as unknown as typeof fetch, minIntervalMs: 0 });
    const r = await osm.route([{ lat: 6.45, lon: 3.39 }, { lat: 6.476, lon: 3.368 }]);
    expect(r).toMatchObject({ km: 4.2, minutes: 13, legs: [{ km: 4.2, minutes: 13 }] });
    expect(r.path).toHaveLength(3);
    expect(r.path[2][0]).toBeCloseTo(6.476, 5);
  });
});
