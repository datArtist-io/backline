// The adventure map's data layer, on the sample trip (illustrative data).
import { describe, expect, it } from "vitest";
import { buildAdventure, fractionNear, hoursOf, pathIndex, pointAt, xpFor } from "../src/app/adventure/model";
import { sampleSource } from "../src/app/adventure/sample";

describe("buildAdventure", () => {
  const m = buildAdventure(sampleSource())!;

  it("builds a world from what the agent found", () => {
    expect(m.city).toBe("Lisbon, Portugal");
    expect(m.sample).toBe(true);
    expect(m.nodes.length).toBeGreaterThanOrEqual(10);
    expect(m.nodes.find((n) => n.id === "v1")).toMatchObject({ kind: "venue", name: "Tasca do Chico", picked: true, fromQloo: true });
    expect(m.nodes.find((n) => n.id === "p1")).toMatchObject({ kind: "stop", picked: true });
  });

  it("keeps every place on the map and north at the top", () => {
    for (const n of m.nodes) {
      expect(Math.abs(n.x)).toBeLessThanOrEqual(m.extent);
      expect(Math.abs(n.z)).toBeLessThanOrEqual(m.extent);
    }
    const airport = m.nodes.find((n) => n.id === "p1")!; // the airport is the northernmost place
    const hotel = m.nodes.find((n) => n.id === "s1")!;
    expect(airport.z).toBeLessThan(hotel.z);
    expect(Math.min(...m.nodes.map((n) => n.z))).toBe(airport.z);
    const tower = m.nodes.find((n) => n.id === "a4")!; // Belém is west of Alfama
    expect(tower.x).toBeLessThan(hotel.x);
  });

  it("turns each plan day into a route of quests in order, with stops along the path", () => {
    expect(m.routes).toHaveLength(3);
    const day1 = m.routes[0];
    expect(day1.label).toBe("Alfama and the castle");
    expect(day1.quests.map((q) => q.nodeId)).toEqual(["p1", "s1", "a1", "a2", "v1"]);
    expect(day1.path).toHaveLength(5);
    expect(day1.geo[0]).toEqual([-9.1318608, 38.7809981]);
    expect(day1.stops.map((s) => s.nodeId)).toEqual(["p1", "s1", "a1", "a2", "v1"]);
    expect(day1.stops[0].at).toBe(0);
    expect(day1.stops[day1.stops.length - 1].at).toBe(1);
    const ats = day1.stops.map((s) => s.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(m.nodes.find((n) => n.id === "p1")!.visits.map((v) => v.day)).toEqual([0, 2]);
  });

  it("puts Qloo's taste on the map: heat, the strongest zone and the signals", () => {
    expect(m.heat.length).toBeGreaterThan(10);
    expect(m.heat.every((h) => h.w >= 0 && h.w <= 1)).toBe(true);
    expect(m.zone).toMatchObject({ name: "Alfama", lat: 38.7117704, lon: -9.12838 });
    expect(m.zone!.r).toBeGreaterThanOrEqual(3);
    expect(m.taste?.signals).toEqual(["Amália Rodrigues", "fado", "jazz"]);
    expect(m.taste?.dishes).toContain("pastel de nata");
    expect(m.heat.every((h) => h.lat > 38.69 && h.lat < 38.73 && h.lon > -9.18 && h.lon < -9.11)).toBe(true);
  });

  it("scores stops in XP, with strong taste matches worth more", () => {
    expect(xpFor(0.95)).toBe(195);
    expect(xpFor(0.3)).toBe(130);
    expect(xpFor(null)).toBe(140);
    const fado = m.nodes.find((n) => n.id === "v1")!;
    const tower = m.nodes.find((n) => n.id === "a4")!;
    expect(fado.xp).toBeGreaterThan(tower.xp);
    expect(m.stats.xp).toBeGreaterThan(1000);
    expect(m.stats.days).toBe(3);
    expect(m.stats.match).toBeGreaterThan(70);
  });

  it("puts the trip on the real map: centre, destination and day routes in lon/lat", () => {
    expect(m.destination).toMatchObject({ name: "Lisbon, Portugal", lat: 38.7077507, lon: -9.1365919 });
    expect(m.center.lat).toBeGreaterThan(38.69);
    expect(m.center.lat).toBeLessThan(38.79);
    for (const r of m.routes) for (const [lon, lat] of r.geo) {
      expect(lon).toBeGreaterThan(-9.25);
      expect(lon).toBeLessThan(-9.1);
      expect(lat).toBeGreaterThan(38.68);
      expect(lat).toBeLessThan(38.79);
    }
    expect(m.origin).toBeNull();
  });

  it("returns nothing until the agent has found something", () => {
    expect(buildAdventure({ title: "x", agent: null })).toBeNull();
    const s = sampleSource();
    expect(buildAdventure({ ...s, agent: { ...s.agent!, stays: [], dines: [], venues: [], activities: [], stops: [] } })).toBeNull();
  });

  it("still draws the places when there is no plan or taste yet", () => {
    const s = sampleSource();
    const early = buildAdventure({ title: "x", agent: s.agent })!;
    expect(early.routes).toEqual([]);
    expect(early.heat).toEqual([]);
    expect(early.zone).toBeNull();
    expect(early.taste).toBeNull();
    expect(early.nodes.length).toBe(m.nodes.length);
  });
});

describe("flying along a path", () => {
  const pts: [number, number][] = [[0, 0], [10, 0], [10, 10]];
  const idx = pathIndex(pts);

  it("measures and samples a path", () => {
    expect(idx.total).toBe(20);
    expect(pointAt(pts, idx, 0)).toMatchObject({ x: 0, z: 0 });
    expect(pointAt(pts, idx, 0.25)).toMatchObject({ x: 5, z: 0 });
    expect(pointAt(pts, idx, 0.75)).toMatchObject({ x: 10, z: 5 });
    expect(pointAt(pts, idx, 1)).toMatchObject({ x: 10, z: 10 });
    expect(pointAt(pts, idx, 2)).toMatchObject({ x: 10, z: 10 });
    expect(pointAt([], { cum: [], total: 0 }, 0.5)).toEqual({ x: 0, z: 0, heading: 0 });
  });

  it("finds how far along a point is, never going backwards", () => {
    expect(fractionNear(pts, idx, [10, 0])).toBe(0.5);
    expect(fractionNear(pts, idx, [0.5, 0.5])).toBe(0);
    expect(fractionNear(pts, idx, [0, 0], 0.5)).toBe(0.5);
  });

  it("reads times", () => {
    expect(hoursOf("14:30")).toBe(14.5);
    expect(hoursOf("2:15 pm")).toBe(14.25);
    expect(hoursOf("12:00 am")).toBe(0);
    expect(hoursOf("evening")).toBeNull();
    expect(hoursOf(null)).toBeNull();
  });
});
