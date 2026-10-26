import { describe, expect, it } from "vitest";
import { answerFollowUp, factsFromResults } from "../src/followup";
import { stubLlm } from "./helpers";

const results = {
  "artist.resolve": { data: { artist: { name: "Test Artist", properties: { primary_genres: "soul" } } }, evidence: [] },
  "tour.cities": { data: { cities: [{ name: "City One", affinity: 0.9 }, { name: "City Two", affinity: 0.8 }] }, evidence: [] },
};

describe("follow-ups", () => {
  it("turns results into facts", () => {
    const f = factsFromResults(results);
    expect(f.render()).toContain("City One, City Two");
    expect(f.size).toBe(2);
  });

  it("keeps only real cited facts and passes through mission suggestions", async () => {
    const llm = stubLlm(() => ({ answer: "Start in City One.", factsUsed: ["f2", "f99"], newMission: { mission: "tour", goal: "Plan a tour for Test Artist <script>" } }));
    const out = await answerFollowUp(llm, "Where should we start?", results);
    expect(out.facts.map((f) => f.id)).toEqual(["f2"]);
    expect(out.suggest).toEqual({ mission: "tour", goal: "Plan a tour for Test Artist script" });
  });

  it("says so plainly without a model", async () => {
    const out = await answerFollowUp(null, "anything", results);
    expect(out.answer).toContain("isn't configured");
  });
});
