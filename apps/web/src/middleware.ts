// Cross-site request guard for the API: a request that changes something (POST, PUT, PATCH, DELETE)
// coming from another website's page is refused. Browsers always send Origin on those requests, so
// a page elsewhere can't make a signed-in person's browser pay, book, call or delete in their name.
// Server-to-server webhooks (Vapi) send no Origin and are checked by their own shared secret.
import { NextResponse, type NextRequest } from "next/server";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(req: NextRequest) {
  if (!UNSAFE.has(req.method)) return NextResponse.next();
  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.next();
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return NextResponse.json({ error: "Request refused." }, { status: 403 });
  }
  const own = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  if (host === own || host === req.nextUrl.host) return NextResponse.next();
  return NextResponse.json({ error: "Request refused: it came from another website." }, { status: 403 });
}

export const config = { matcher: "/api/:path*" };
