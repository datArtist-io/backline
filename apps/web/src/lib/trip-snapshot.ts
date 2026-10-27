// Keeps a trip exactly as it was when the person steps away (to Account, a receipt, sign-in…), so
// "Back to your trip" picks up where they left off instead of planning again. Per tab (sessionStorage).

const KEY = (url: string) => `bl.trip:${url}`;
const LAST = "bl.lastTrip";
const MAX_AGE = 6 * 3600_000;

export type TripSnapshot<T> = { at: number; data: T };

export function saveTrip<T>(url: string, data: T): void {
  try {
    sessionStorage.setItem(KEY(url), JSON.stringify({ at: Date.now(), data } satisfies TripSnapshot<T>));
    sessionStorage.setItem(LAST, url);
  } catch {
    /* storage full or blocked: the trip still works, it just plans again on return */
  }
}

export function readTrip<T>(url: string): T | null {
  try {
    const raw = sessionStorage.getItem(KEY(url));
    if (!raw) return null;
    const s = JSON.parse(raw) as TripSnapshot<T>;
    return Date.now() - s.at < MAX_AGE ? s.data : null;
  } catch {
    return null;
  }
}

/** The trip this tab was last on, for the "Back to your trip" button. */
export function lastTrip(): string | null {
  try {
    const url = sessionStorage.getItem(LAST);
    return url && url.startsWith("/mission") && readTrip(url) ? url : null;
  } catch {
    return null;
  }
}

/** Small per-trip UI state (which calls finished, refunds, rescued rows), kept alongside the trip. */
export function keep<T>(key: string, value?: T): T | null {
  try {
    if (value !== undefined) sessionStorage.setItem(`bl.k:${key}`, JSON.stringify(value));
    const raw = sessionStorage.getItem(`bl.k:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
