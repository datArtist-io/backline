// A per-client request limit for the API routes. In memory, so each server instance counts on
// its own: enough to stop a script hammering one instance, not a global quota.

/** A checker that says whether a client has gone over `max` requests in the last `windowMs`. */
export function rateLimiter(max: number, windowMs = 60_000): (key: string) => boolean {
  const hits = new Map<string, { n: number; at: number }>();
  return (key) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.at > windowMs) {
      hits.set(key, { n: 1, at: now });
      if (hits.size > 5000) hits.clear();
      return false;
    }
    h.n += 1;
    return h.n > max;
  };
}

/** The client's IP address as the hosting proxy reports it. */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
