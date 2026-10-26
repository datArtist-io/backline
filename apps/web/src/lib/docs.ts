// Attached documents travel from the home page to the mission in this tab's session storage
// (never in the URL) and are sent along with the mission request.
import type { DocumentText } from "@backline/engine";

const PREFIX = "backline.docs.";
export const MAX_DOCS = 3;

const valid = (d: unknown): d is DocumentText =>
  Boolean(d) && typeof (d as DocumentText).name === "string" && typeof (d as DocumentText).text === "string" && (d as DocumentText).text.length <= 60_000;

/** Keep documents for the next page; returns the key to pass in the URL, or null if there's nothing to keep. */
export function saveDocs(docs: DocumentText[]): string | null {
  if (docs.length === 0) return null;
  const key = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(docs.slice(0, MAX_DOCS).map((d) => ({ name: d.name, text: d.text, kind: d.kind, truncated: d.truncated }))));
    return key;
  } catch {
    return null;
  }
}

export function loadDocs(key?: string | null): DocumentText[] {
  if (!key || !/^[a-z0-9]{4,32}$/.test(key)) return [];
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter(valid).slice(0, MAX_DOCS) : [];
  } catch {
    return [];
  }
}
