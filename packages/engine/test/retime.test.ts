import { describe, expect, it } from "vitest";
import { retimeDays, travelMinutes } from "../src/skills/trip";

const heathrow = { lat: 51.47, lon: -0.4543 };
const paddington = { lat: 51.5154, lon: -0.1755 };
const gallery = { lat: 51.5089, lon: -0.1283 };
const zedel = { lat: 51.5101, lon: -0.1357 };
const at = (id: string) => ({ lhr: heathrow, hotel: paddington, ng: gallery, zedel } as Record<string, { lat: number; lon: number }>)[id] ?? null;

describe("a day you can actually do", () => {
  it("leaves real time to get from the airport to the hotel", () => {
    const [d] = retimeDays([{ items: [
      { time: "13:30", title: "Arrive at Heathrow Airport", placeId: "lhr" },
      { time: "13:45", title: "Travel to hotel", placeId: null },
      { time: "14:00", title: "Check in", placeId: "hotel" },
      { time: "15:00", title: "Visit The National Gallery", placeId: "ng" },
      { time: "19:30", title: "Dinner at Brasserie Zedel", placeId: "zedel" },
    ] }], at);
    const t = Object.fromEntries(d.items.map((i) => [i.title, i.time]));
    expect(t["Travel to hotel"]).toBe("14:30"); // an hour through arrivals
    expect(t["Check in"] >= "15:15").toBe(true); // plus ~50 min across London
    expect(t["Visit The National Gallery"] >= "16:00").toBe(true);
    expect(t["Dinner at Brasserie Zedel"]).toBe("19:30"); // already fine, untouched
  });
  it("never moves the time they asked for", () => {
    const [d] = retimeDays([{ items: [
      { time: "19:00", title: "Visit The National Gallery", placeId: "ng" },
      { time: "20:00", title: "Dinner at Brasserie Zedel", placeId: "zedel" },
    ] }], at, "20:00");
    expect(d.items[1].time).toBe("20:00");
  });
  it("walks short hops and rides longer ones", () => {
    expect(travelMinutes(gallery, zedel)).toBeLessThan(15);
    expect(travelMinutes(heathrow, paddington)).toBeGreaterThan(40);
  });
});
