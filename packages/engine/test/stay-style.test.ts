import { describe, expect, it } from "vitest";
import { groundTrip, normalizeTrip, stayStyleIn, describeTrip } from "../src/trip-request";
import { fitStayStyle, stayKindOf } from "../src/skills/places";
import { stayStyleLinks } from "../src/skills/trip";
import type { Place } from "../src/skills/places";

const TODAY = "2026-11-03";
const place = (name: string, tags: string[] = [], fit = 0.6): Place =>
  ({ id: name, name, address: null, phone: null, email: null, website: null, priceLevel: null, rating: null, affinity: null, image: null, lat: null, lon: null, tags, fit, why: [], priceNote: null, extra: null, sources: [], kind: "stay", source: "osm" }) as Place;

describe("kinds of stay", () => {
  it("reads the kind of stay from what people say", () => {
    expect(stayStyleIn("Find me an Airbnb in Lisbon for the weekend")).toBe("home");
    expect(stayStyleIn("a villa in Bali with friends")).toBe("home");
    expect(stayStyleIn("backpacking through Berlin, cheap hostel please")).toBe("hostel");
    expect(stayStyleIn("a cosy B&B in Edinburgh")).toBe("guesthouse");
    expect(stayStyleIn("all-inclusive resort in Cancun")).toBe("resort");
    expect(stayStyleIn("I don't want a hotel, find an apartment")).toBe("home");
    expect(stayStyleIn("a weekend in Rome")).toBeNull();
  });

  it("lets what they said beat the model, and keeps hotels the default", () => {
    const g = groundTrip({ destination: "Lisbon, Portugal", stayStyle: "hotel" }, "Airbnb in Lisbon please");
    expect(g?.stayStyle).toBe("home");
    expect(normalizeTrip({ destination: "Rome, Italy", startDate: "2026-11-06", endDate: "2026-11-09", adults: 2 }, null, {}, TODAY)?.stayStyle).toBe("hotel");
  });

  it("looks at whole homes too for groups and long stays, and says so", () => {
    const group = normalizeTrip({ destination: "Rome, Italy", startDate: "2026-11-06", endDate: "2026-11-09", adults: 6 }, null, {}, TODAY)!;
    expect(group.stayStyle).toBe("mixed");
    expect(group.assumptions.join(" ")).toMatch(/whole homes/);
    expect(describeTrip(group)).toMatch(/Airbnb-style/);
  });

  it("remembers a saved preference for Airbnbs", () => {
    expect(normalizeTrip({ destination: "Paris, France", adults: 1 }, null, { stayPrefs: ["Airbnb", "a kitchen"] }, TODAY)?.stayStyle).toBe("home");
  });

  it("ranks the kind they want first", () => {
    expect(stayKindOf(place("Trastevere Loft", ["Apartment"]))).toBe("home");
    expect(stayKindOf(place("Casa Rosa Guest House"))).toBe("guesthouse");
    const loft = fitStayStyle(place("Trastevere Loft", ["Apartment"], 0.5), "home");
    const chain = fitStayStyle(place("Hilton Rome", ["Hotel"], 0.7), "home");
    expect(loft.fit).toBeGreaterThan(chain.fit);
    expect(loft.why[0]).toBe("Whole home");
    expect(fitStayStyle(place("Hilton Rome", ["Hotel"], 0.7), "hotel").fit).toBe(0.7);
  });

  it("opens Airbnb and Vrbo with the dates and guests for whole homes", () => {
    const base = { destination: "Rome, Italy", startDate: "2026-11-06", endDate: "2026-11-09", adults: 3, rooms: 2, needs: ["stay", "dine"] as ("stay" | "dine")[] };
    const links = stayStyleLinks({ ...base, stayStyle: "home" } as never);
    expect(links.map((l) => l.site)).toEqual(["Airbnb", "Vrbo"]);
    expect(links[0].url).toContain("airbnb.com/s/Rome%2C%20Italy/homes");
    expect(links[0].url).toContain("checkin=2026-11-06");
    expect(links[0].url).toContain("adults=3");
    expect(stayStyleLinks({ ...base, stayStyle: "hostel" } as never)[0].url).toContain("ht_id%3D203");
    expect(stayStyleLinks({ ...base, stayStyle: "hotel" } as never)).toEqual([]);
    // Opened where Qloo says their taste peaks.
    const qloo = stayStyleLinks({ ...base, stayStyle: "home" } as never, "Trastevere");
    expect(qloo[0].title).toBe("Browse whole homes in Trastevere on Airbnb for your dates");
    expect(decodeURIComponent(qloo[0].url)).toContain("/s/Trastevere, Rome, Italy/homes");
  });
});

import { chooseStay } from "../src/skills/trip";
describe("keeping the kind of stay", () => {
  it("doesn't swap a home for a hotel just because the hotel has a bookable rate", () => {
    const home = { ...place("Upon Lisbon Prime Residences", ["Apartment"]), id: "h" };
    const hotel = { ...place("Epic Sana Lisboa Hotel", ["Hotel"]), id: "x", offer: { offerId: "o", total: 500, currency: "USD", perNight: 160, roomName: "Twin", board: null, refundable: true, cancellation: null, provider: "liteapi" } } as Place;
    const trip = { destination: "Lisbon, Portugal", startDate: "2026-11-20", endDate: "2026-11-23", adults: 1, rooms: 1, budget: { amount: null, currency: "USD", scope: null }, priceTier: 2, needs: ["stay"], stayStyle: "home" } as never;
    expect(chooseStay([home, hotel], "h", trip).id).toBe("h");
    expect(chooseStay([home, hotel], "h", { ...(trip as object), stayStyle: "hotel" } as never).id).toBe("x");
  });
});
