import { describe, expect, it } from "vitest";
import { goalOf, inboundAssistant, tripArgs, tripCode, tripFromCall } from "../src/lib/vapi";

describe("Call Backline", () => {
  it("reads the tool's arguments, as an object or a JSON string", () => {
    const t = tripArgs('{"destination":"Lisbon","days":"4","travellers":2,"loves":"fado and seafood","email":" Ada@Example.com "}');
    expect(t).toMatchObject({ destination: "Lisbon", days: 4, travellers: 2, loves: "fado and seafood", email: "ada@example.com" });
    expect(tripArgs({ days: 3 })).toBeNull();
    expect(tripArgs("not json")).toBeNull();
    expect(tripArgs({ destination: "Paris", email: "nope" })?.email).toBeNull();
    expect(tripArgs({ destination: "Paris", days: 400 })?.days).toBe(14);
  });

  it("turns a call into the same sentence a typed request would be", () => {
    expect(goalOf({ destination: "Lisbon", days: 4, travellers: 2, loves: "we love fado", when: "next month", from: "Lagos", email: null })).toBe("4 days in Lisbon for 2, we love fado, next month, from Lagos");
    expect(goalOf({ destination: "Tokyo", days: null, travellers: null, loves: null, when: null, from: null, email: null })).toBe("3 days in Tokyo for 2");
  });

  it("gives each call a stable 4-digit code", () => {
    const a = tripCode("3f9c0a2e-0000-4000-8000-000000000001");
    expect(a).toMatch(/^\d{4}$/);
    expect(tripCode("3f9c0a2e-0000-4000-8000-000000000001")).toBe(a);
  });

  it("finds the planned trip in a call record", () => {
    const call = { artifact: { messages: [{ role: "bot", message: "Hi" }, { role: "tool_calls", toolCalls: [{ function: { name: "plan_trip", arguments: '{"destination":"Accra","days":2}' } }] }] } };
    expect(tripFromCall(call)?.destination).toBe("Accra");
    expect(tripFromCall({ messages: [] })).toBeNull();
  });

  it("answers as an AI agent that never takes payment details", () => {
    const a = inboundAssistant();
    const prompt = a.model.messages[0].content;
    expect(prompt).toMatch(/you're an AI agent/);
    expect(prompt).toMatch(/Never ask for card/);
    expect(a.model.tools[0].function.name).toBe("plan_trip");
    expect(a.metadata).toEqual({ app: "backline", kind: "inbound" });
  });
});
