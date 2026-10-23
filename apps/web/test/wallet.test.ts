import { describe, expect, it } from "vitest";
import { checksumAddress, keccak256 } from "../src/lib/keccak";

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("keccak256", () => {
  it("matches the standard test vectors", () => {
    expect(hex(keccak256(new Uint8Array()))).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(hex(keccak256(new TextEncoder().encode("abc")))).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  });
});

describe("checksumAddress", () => {
  it("produces EIP-55 addresses", () => {
    for (const a of ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"]) {
      expect(checksumAddress(a.toLowerCase())).toBe(a);
    }
  });
  it("rejects anything that isn't an address", () => {
    expect(() => checksumAddress("0x123")).toThrow("Not an Ethereum address");
  });
});
