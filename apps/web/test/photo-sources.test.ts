import { describe, expect, it } from "vitest";
import { BUSY_RETRY_S, ION_GOOGLE_ASSET, isBusy, photoCredit, photoSources } from "../src/app/adventure/photo-sources";

describe("photoreal sources", () => {
  it("tries Google first, then Cesium ion", () => {
    expect(photoSources("g-key", "ion-token")).toEqual([
      { kind: "google", key: "g-key" },
      { kind: "ion", token: "ion-token" },
    ]);
  });
  it("uses Cesium ion alone when there is no Google key", () => {
    expect(photoSources("", " ion-token ")).toEqual([{ kind: "ion", token: "ion-token" }]);
  });
  it("offers nothing without a key or token", () => {
    expect(photoSources("  ", "")).toEqual([]);
  });
  it("credits Google, and Cesium ion when it serves the tiles", () => {
    expect(photoCredit("google", "")).toBe("Google");
    expect(photoCredit("ion", "Data SIO, NOAA")).toBe("Google · Cesium ion · Data SIO, NOAA");
  });
  it("loads Google's Photorealistic 3D Tiles asset on ion", () => {
    expect(ION_GOOGLE_ASSET).toBe(2275207);
  });
  it("waits and retries when Google's per-minute session limit is hit, but not for a refused key", () => {
    expect(isBusy(new Error("GoogleCloudAuth: Failed to load data with error code 429"))).toBe(true);
    expect(isBusy("Quota exceeded for quota metric '3D Tiles root requests' RESOURCE_EXHAUSTED")).toBe(true);
    expect(isBusy(new Error("GoogleCloudAuth: Failed to load data with error code 404"))).toBe(false);
    expect(isBusy(new Error("CesiumIonAuthPlugin: Failed to load data with error code 401"))).toBe(false);
    expect(isBusy(undefined)).toBe(false);
    expect(BUSY_RETRY_S.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(120);
  });
});
