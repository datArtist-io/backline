import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

process.env.TRAVEL_DOCS_KEY = randomBytes(32).toString("base64");
const { open, seal, vaultReady } = await import("../src/lib/vault");

describe("travel document vault", () => {
  const passport = { number: "A12345678", familyName: "Obi" };

  it("round-trips for the same person and hides the contents", () => {
    expect(vaultReady()).toBe(true);
    const sealed = seal(passport, "user-1");
    expect(sealed).not.toContain("A12345678");
    expect(open(sealed, "user-1")).toEqual(passport);
  });

  it("won't open another person's row", () => {
    const sealed = seal(passport, "user-1");
    expect(() => open(sealed, "user-2")).toThrow();
  });

  it("detects tampering", () => {
    const parts = seal(passport, "user-1").split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 1;
    parts[3] = data.toString("base64");
    expect(() => open(parts.join("."), "user-1")).toThrow();
  });
});
