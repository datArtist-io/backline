import { describe, expect, it } from "vitest";
import { ION_GOOGLE_ASSET, photoCredit, photoSources } from "../src/app/adventure/photo-sources";

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
});
