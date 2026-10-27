import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// placeIn lives in a client component; evaluate just the function to test it without React.
const src = readFileSync(new URL("../src/app/mission/MissionView.tsx", import.meta.url), "utf8");
const body = /export function placeIn[\s\S]*?\n}\n/.exec(src)![0].replace("export function placeIn(goal: string): string | null", "function placeIn(goal)");
const placeIn = new Function(`${body}; return placeIn;`)() as (g: string) => string | null;

describe("placeIn", () => {
  it("reads the destination from the request", () => {
    expect(placeIn("PLAN A TRIP TO LONDON FOR ME. 3DAYS TRIP FROM NOW.")).toBe("London");
    expect(placeIn("Plan a weekend in Lisbon for 2 people from London")).toBe("Lisbon");
    expect(placeIn("A long weekend in Tokyo for 2 from New York, we love jazz")).toBe("Tokyo");
    expect(placeIn("dinner for 4 in Mexico City on Friday")).toBe("Mexico City");
    expect(placeIn("book me something nice")).toBeNull();
  });
});
