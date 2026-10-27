// Is a booking website live and working before we send someone to it? Fetches the page server-side
// (public hosts only), follows redirects, and reports whether it answered, whether it looks like a real
// page (not parked or an error), and whether it may be shown inside Backline's mini browser.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { embeddable, privateAddress } from "@/lib/site-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(30);
const PARKED = /domain (is )?for sale|buy this domain|parked (free|domain)|this domain may be for sale|sedoparking|hugedomains|godaddy\.com\/domainsearch|account suspended|site not found|404 not found|coming soon/i;

async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return null;
  const ips = isIP(u.hostname) ? [u.hostname] : (await lookup(u.hostname, { all: true }).catch(() => [])).map((x) => x.address);
  if (!ips.length || ips.some(privateAddress)) return null;
  return u;
}

export async function GET(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many checks. Wait a moment." }, { status: 429 });
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let url = await safeUrl(raw);
  if (!url) return Response.json({ ok: false, reason: "That address can't be checked." }, { status: 400 });
  const started = Date.now();
  try {
    // Follow redirects by hand so every hop is checked against private addresses.
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; BacklineSiteCheck/1.0; +https://backline-beta-one.vercel.app)", Accept: "text/html,*/*" }, signal: AbortSignal.timeout(8000) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc) break;
      const next = await safeUrl(new URL(loc, url).toString());
      if (!next) return Response.json({ ok: false, reason: "The site redirects somewhere that can't be checked." });
      url = next;
    }
    if (!res) throw new Error("no response");
    const type = res.headers.get("content-type") ?? "";
    const html = type.includes("html") ? (await res.text()).slice(0, 200_000) : "";
    const title = html.match(/<title[^>]*>([^<]{1,140})/i)?.[1]?.trim() ?? null;
    const parked = PARKED.test(title ?? "") || PARKED.test(html.slice(0, 20_000));
    // Bot walls (403/429/503 from Cloudflare and friends) still mean the site is up for a person.
    const up = res.status < 400 || [401, 403, 405, 429, 503].includes(res.status);
    const ok = up && !parked;
    return Response.json(
      {
        ok,
        status: res.status,
        finalUrl: url.toString(),
        title,
        ms: Date.now() - started,
        embeddable: ok && res.status < 400 && embeddable(res.headers.get("x-frame-options"), res.headers.get("content-security-policy")),
        reason: ok ? null : parked ? "The site looks parked or not in use." : `The site answered with an error (${res.status}).`,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json({ ok: false, reason: err instanceof Error && /timeout|abort/i.test(err.name + err.message) ? "The site didn't answer in time." : "The site couldn't be reached." });
  }
}
