// The signed-in traveller's private calendar link: subscribe once, and every trip they plan shows up.
import { getSession } from "@/lib/session";
import { feedToken, subscribeLinks } from "@/lib/calendar-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ ok: false, reason: "Sign in to keep your calendar in sync." }, { status: 401 });
  const token = feedToken(session.user.id);
  if (!token) return Response.json({ ok: false, reason: "Calendar sync isn't set up on this site yet." }, { status: 503 });
  const feed = `${new URL(req.url).origin}/api/calendar/feed/${token}.ics`;
  return Response.json({ ok: true, feed, ...subscribeLinks(feed) });
}
