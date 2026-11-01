// Where the photoreal city comes from, and the credit line each source requires. Pure, so it is tested.

/** Where the photoreal tiles come from. */
export type PhotoSource = { kind: "google"; key: string } | { kind: "ion"; token: string };
/** Google's Photorealistic 3D Tiles as a Cesium ion asset. */
export const ION_GOOGLE_ASSET = 2275207;
/** The sources this deployment can use, best first: Google direct, then Cesium ion. */
export function photoSources(google: string, ion: string): PhotoSource[] {
  const out: PhotoSource[] = [];
  if (google.trim()) out.push({ kind: "google", key: google.trim() });
  if (ion.trim()) out.push({ kind: "ion", token: ion.trim() });
  return out;
}
/** The credit line the providers require on screen. */
export function photoCredit(source: PhotoSource["kind"], credits: string): string {
  const base = source === "ion" ? "Google · Cesium ion" : "Google";
  return credits ? `${base} · ${credits}` : base;
}
