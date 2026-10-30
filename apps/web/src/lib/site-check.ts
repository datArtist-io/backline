// Pure checks for the booking-site verifier (api/site-check).
import { isIP } from "node:net";

/** Private, loopback and link-local addresses are never fetched. Pure. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
    // An IPv4 address written inside IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) is judged as IPv4.
    const dotted = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return privateAddress(dotted[1]);
    const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
      return privateAddress(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
    }
    // Loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), multicast.
    return v === "::" || v === "::1" || /^(f[cd]|fe[89ab]|fe[c-f]|ff)/.test(v) || /^::(\d|[0-9a-f]{1,4}:)/.test(v);
  }
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

