import { describe, expect, it } from "vitest";
import { estimatedTravel } from "../src/skills/trip-travel";
import { excerpt, knownEmergency, researchFromSources } from "../src/skills/trip-intel";

// Judges must never see empty "getting there" or "know before you go" tabs when the AI model is down.
describe("field guide without a model", () => {
  const page = (title: string, content: string, url = "https://example.com/x") => ({ title, url, content, publishedDate: null });

  it("estimates the flight and links live fares and the route planner", () => {
    const out = estimatedTravel("Lagos, Nigeria", "Dubai", 5874, "2026-11-14", [page("Lagos to Dubai - Rome2rio", "Fly, about 7 hours.", "https://www.rome2rio.com/s/Lagos/Dubai")]);
    expect(out[0]).toMatchObject({ mode: "flight", verified: false, best: true });
    expect(out[0].duration).toMatch(/estimate/);
    expect(out[0].url).toContain("google.com/travel/flights");
    expect(out.some((o) => o.site === "rome2rio.com")).toBe(true);
  });

  it("offers a drive for a short trip", () => {
    expect(estimatedTravel("Lagos", "Ibadan", 120, null, []).map((o) => o.mode)).toEqual(["car"]);
  });

  it("shows research as found, linked, with tour pages as guides", () => {
    const r = researchFromSources([{ id: "entry", results: [page("UAE visa", "## Visa\nMost visitors need a visa before arriving in the UAE. Apply in advance.", "https://u.ae/visa")] }], [page("Dubai Private Tours - Tripadvisor", "Private guided tours of old Dubai and the souks.")])!;
    expect(r.sections[0]).toMatchObject({ id: "entry", items: [{ site: "u.ae", verified: true }] });
    expect(r.sections[0].items[0].text).toMatch(/^Most visitors need a visa/);
    expect(r.guides[0].name).toBe("Dubai Private Tours");
  });

  it("knows the main emergency numbers, marked unverified", () => {
    expect(knownEmergency("AE")).toMatchObject({ police: "999", ambulance: "998", verified: false });
    expect(knownEmergency("PT")?.general).toBe("112");
    expect(knownEmergency("ZZ")).toBeNull();
    expect(excerpt("| a | b |\n# Head\nShort. This sentence is long enough to be kept as the excerpt here.")).toContain("long enough");
  });
});
