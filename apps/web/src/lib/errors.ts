// Reports browser errors to /api/client-error: uncaught errors, unhandled promise rejections and
// render errors caught by the page boundaries. Never more than a few a minute, never twice the same.
"use client";

const seen = new Set<string>();
let sent = 0;

export function report(kind: "error" | "unhandledrejection" | "render" | "global", err: unknown, extra: { digest?: string } = {}): void {
  try {
    if (typeof window === "undefined" || sent >= 10) return;
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err).slice(0, 200));
    const key = `${kind}:${e.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    const body = JSON.stringify({ kind, message: e.message, stack: e.stack?.slice(0, 1500), page: location.pathname + location.search.slice(0, 80), digest: extra.digest, ua: navigator.userAgent });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }));
    else void fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    /* reporting must never throw */
  }
}

/** Installs the window listeners once. */
export function watchErrors(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __blErrors?: boolean };
  if (w.__blErrors) return;
  w.__blErrors = true;
  window.addEventListener("error", (ev) => report("error", ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => report("unhandledrejection", ev.reason));
}
