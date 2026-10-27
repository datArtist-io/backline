import { describe, expect, it } from "vitest";
import { embeddable, privateAddress } from "../src/lib/site-check";

describe("site check", () => {
  it("never fetches private or loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.1.1", "169.254.169.254", "::1", "fd00::1"]) expect(privateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "104.18.2.1", "2606:4700::1111"]) expect(privateAddress(ip)).toBe(false);
  });
  it("reads whether a page may be framed", () => {
    expect(embeddable(null, null)).toBe(true);
    expect(embeddable("DENY", null)).toBe(false);
    expect(embeddable("SAMEORIGIN", null)).toBe(false);
    expect(embeddable(null, "default-src 'self'; frame-ancestors 'self'")).toBe(false);
    expect(embeddable(null, "frame-ancestors *")).toBe(true);
  });
});
