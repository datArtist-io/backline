import { describe, expect, it, vi } from "vitest";
import { InputError, UpstreamError } from "../src/errors";
import { TtlCache, foldText, mapLimit, withRetry, withTimeout } from "../src/util";
import { extractJson } from "../src/clients/llm";

describe("withRetry", () => {
  it("retries retryable upstream errors, then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new UpstreamError("qloo", 503, "down"))
      .mockRejectedValueOnce(new UpstreamError("qloo", 429, "slow down"))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { baseMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors", async () => {
    const fn = vi.fn().mockRejectedValue(new UpstreamError("qloo", 400, "bad request"));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry input errors", async () => {
    const fn = vi.fn().mockRejectedValue(new InputError("nope"));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry limit", async () => {
    const fn = vi.fn().mockRejectedValue(new UpstreamError("llm", null, "network"));
    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow("network");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("withTimeout", () => {
  it("rejects slow work", async () => {
    await expect(withTimeout(new Promise((r) => setTimeout(r, 200)), 10, "slow")).rejects.toThrow("timed out");
  });
});

describe("TtlCache", () => {
  it("evicts the oldest entry beyond its size", () => {
    const c = new TtlCache<number>(10_000, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")).toBe(3);
  });

  it("expires entries after the TTL", async () => {
    const c = new TtlCache<number>(5, 10);
    c.set("a", 1);
    await new Promise((r) => setTimeout(r, 15));
    expect(c.get("a")).toBeUndefined();
  });
});

describe("foldText", () => {
  it("ignores case, accents and punctuation", () => {
    expect(foldText("Beyoncé!")).toBe("beyonce");
    expect(foldText("  A$AP  Rocky ")).toBe("a ap rocky");
  });
});

describe("mapLimit", () => {
  it("keeps result order", async () => {
    const out = await mapLimit([30, 10, 20], 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });
});

describe("extractJson", () => {
  it("strips reasoning tags and code fences", () => {
    expect(extractJson('<think>hmm</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
