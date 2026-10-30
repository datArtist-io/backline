/** "example.com" from a URL; the text as given if it isn't a valid URL (never throws during render). */
export function hostOf(url: string | null | undefined): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return (url ?? "").replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}
