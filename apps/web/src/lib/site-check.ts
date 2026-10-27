// Pure checks for the booking-site verifier (api/site-check).
import { isIP } from "node:net";

/** Private, loopback and link-local addresses are never fetched. Pure. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) return /^(::1|fc|fd|fe80|::ffff:(127|10|192\.168|169\.254))/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** May this page be framed by our site? Reads X-Frame-Options and CSP frame-ancestors. Pure. */
export function embeddable(xfo: string | null, csp: string | null): boolean {
  if (xfo && /deny|sameorigin/i.test(xfo)) return false;
  const fa = csp?.match(/frame-ancestors([^;]*)/i)?.[1]?.trim();
  if (fa && !/\*(\s|$)/.test(fa) && !/backline-beta-one\.vercel\.app/.test(fa)) return false;
  return true;
}

