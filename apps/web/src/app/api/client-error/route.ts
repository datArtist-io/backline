// Browser errors, one JSON line each, so a log drain can count and group them (the bug-finding book,
// section 8.1). Scrubbed of emails, phone numbers and anything key-shaped; capped in size and rate.
// A DSN-based service (Sentry) can replace this later without touching the pages: they only call report().
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { scrub } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tooMany = rateLimiter(30, 60_000);

export async function POST(req: Request) {
  if (tooMany(clientIp(req))) return new Response(null, { status: 429 });
  const raw = await req.text();
  if (raw.length > 8000) return new Response(null, { status: 413 });
  let b: { message?: unknown; stack?: unknown; page?: unknown; kind?: unknown; digest?: unknown; ua?: unknown };
  try {
    b = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const str = (v: unknown, n: number) => (typeof v === "string" ? scrub(v).slice(0, n) : null);
  console.error(
    JSON.stringify({
      bl: "client-error",
      at: new Date().toISOString(),
      kind: str(b.kind, 40) ?? "error",
      message: str(b.message, 300),
      stack: str(b.stack, 1500),
      page: str(b.page, 200),
      digest: str(b.digest, 80),
      ua: str(b.ua, 160),
      country: req.headers.get("x-vercel-ip-country"),
    }),
  );
  return new Response(null, { status: 204 });
}
