import { describe, expect, it } from "vitest";
import { withStatedLikes } from "../src/missions";

describe("stated taste survives the model", () => {
  it("recovers the star and the listed tastes", () => {
    const t = withStatedLikes({ likes: [], inspiredBy: null }, "4 days in Paris for 2 from New York, the way Pharrell Williams would, fashion and music");
    expect(t?.inspiredBy).toBe("Pharrell Williams");
    expect(t?.likes).toEqual(expect.arrayContaining(["fashion", "music"]));
  });
  it("keeps the model's own star", () => {
    expect(withStatedLikes({ likes: [], inspiredBy: "Drake" }, "3 nights in Dubai the way Drake would")?.inspiredBy).toBe("Drake");
  });
});
