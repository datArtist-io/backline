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

/**
 * A refusal that clears on its own: Google's per-minute limit on new 3D Tiles sessions (shared by everyone
 * on Cesium ion's free plan) answers 429. Worth waiting and trying the same source again.
 */
export function isBusy(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /\b429\b|RESOURCE_EXHAUSTED|quota|too many requests/i.test(text);
}
/** Waits before each retry of a busy source, in seconds: about a minute and a half in all. */
export const BUSY_RETRY_S = [12, 25, 45];
