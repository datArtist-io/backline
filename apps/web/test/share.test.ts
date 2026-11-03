import { describe, expect, it } from "vitest";
import { mailtoUrl, plainText, telegramUrl, tripMessage, whatsappUrl, type ShareTrip } from "../src/lib/share";

const trip: ShareTrip = {
  title: "A weekend in Lisbon",
  chips: ["Lisbon", "1–3 Nov", "2 people"],
  summary: "Fado nights and tiled streets.",
  days: [
    { heading: "Day 1: Alfama", date: "Sunday 1 November", items: [{ time: "15:00", title: "Check in at Memmo Alfama" }, { time: null, title: "Walk to the castle" }] },
    { heading: "Day 2: Belém", date: "", items: [{ time: "09:00", title: "Pastéis de Belém" }] },
  ],
  budget: [{ item: "Hotel, 2 nights", amount: "€420" }, { item: "Dinner", amount: "To confirm" }],
  tips: ["Wear good shoes", "Book fado ahead", "Trams fill up", "A fourth tip"],
};

describe("sharing the plan", () => {
  it("writes the whole plan as one message", () => {
    const m = tripMessage(trip, "https://backline.example");
    expect(m).toContain("✈️ A weekend in Lisbon");
    expect(m).toContain("Lisbon · 1–3 Nov · 2 people");
    expect(m).toContain("*Day 1: Alfama* (Sunday 1 November)");
    expect(m).toContain("15:00  Check in at Memmo Alfama");
    expect(m).toContain("• Walk to the castle");
    expect(m).toContain("Hotel, 2 nights: €420");
    expect(m).not.toContain("A fourth tip");
    expect(m.endsWith("Planned with Backline · https://backline.example")).toBe(true);
  });
  it("keeps whole sections within the limit and says when some are left out", () => {
    const m = tripMessage(trip, "https://backline.example", 140);
    expect(m.length).toBeLessThanOrEqual(140 + 60);
    expect(m).toContain("…and more in the full plan on Backline.");
    expect(m).toContain("Planned with Backline");
  });
  it("builds share links with the text encoded", () => {
    expect(whatsappUrl("a & b")).toBe("https://wa.me/?text=a%20%26%20b");
    expect(telegramUrl("https://x.y", "hi there")).toBe("https://t.me/share/url?url=https%3A%2F%2Fx.y&text=hi%20there");
    expect(mailtoUrl("Trip", "Line 1\nLine 2")).toBe("mailto:?subject=Trip&body=Line%201%0ALine%202");
  });
  it("drops chat-app bold stars for email", () => {
    expect(plainText("*Day 1: Alfama* (Sun)\n*Budget*")).toBe("Day 1: Alfama (Sun)\nBudget");
  });
});
