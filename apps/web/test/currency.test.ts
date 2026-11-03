import { describe, expect, it } from "vitest";
import { convert, formatMoney } from "../src/lib/currency";

describe("display currency", () => {
  const rates = { USD: 1, NGN: 1500, EUR: 0.9 };
  it("converts through the dollar", () => {
    expect(convert(1500, "NGN", "USD", rates)).toBe(1);
    expect(convert(100, "USD", "EUR", rates)).toBeCloseTo(90);
    expect(convert(5, "eur", "EUR", null)).toBe(5);
    expect(convert(5, "XYZ", "USD", rates)).toBeNull();
  });
  it("shows dollars by default and keeps the original currency without rates", () => {
    expect(formatMoney(120, "USD")).toBe("$120");
    expect(formatMoney(120, "EUR")).toBe("€120");
  });
});
