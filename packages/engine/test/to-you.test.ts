import { describe, expect, it } from "vitest";
import { toYou } from "../src/you";

describe("toYou", () => {
  it("speaks to the traveller", () => {
    expect(toYou("This plan centers on ramen, aligning with the client’s tastes.")).toBe("This plan centers on ramen, aligning with your tastes.");
    expect(toYou("The client's hotel is close to the museum.")).toBe("Your hotel is close to the museum.");
    expect(toYou("Days are tailored to the client.")).toBe("Days are tailored to you.");
    expect(toYou("Your days center on Ghibli.")).toBe("Your days center on Ghibli.");
  });
});
