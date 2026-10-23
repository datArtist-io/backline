import { TimeoutError, UpstreamError } from "./errors";

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true }
    );
  });

export type RetryOptions = {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (err: unknown) => boolean;
};

const defaultShouldRetry = (err: unknown) => err instanceof UpstreamError && err.retryable;

/** Exponential backoff with full jitter. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseMs = 300, maxMs = 4000, signal, shouldRetry = defaultShouldRetry } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err) || signal?.aborted) throw err;
      const cap = Math.min(maxMs, baseMs * 2 ** attempt);
      await sleep(Math.random() * cap, signal);
      attempt += 1;
    }
  }
}

/** Reject if `promise` doesn't settle within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** Small TTL + size-bounded cache (least-recently-set eviction). Private, in-memory only. */
export class TtlCache<V> {
  private map = new Map<string, { at: number; value: V }>();
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { at: Date.now(), value });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/** Lower-case, strip accents and punctuation: "Beyoncé!" -> "beyonce". */
export function foldText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Run async tasks with a concurrency limit, preserving order of results. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
