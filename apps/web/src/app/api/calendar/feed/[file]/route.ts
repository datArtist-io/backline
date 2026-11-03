// The calendar feed a calendar app polls: the traveller's saved trips as events. The link is signed
// for one person, so it is read with the server key, and only that person's trips are returned.
import { buildFeed, openFeedToken } from "@/lib/calendar-feed";
import type { SavedTrip } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const userId = openFeedToken(file.replace(/\.ics$/i, ""));
  if (!userId) return new Response("Not found", { status: 404 });
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response("Calendar sync isn't set up", { status: 503 });
  try {
    const q = `trips?select=id,title,destination,start_date,end_date,details,created_at&user_id=eq.${encodeURIComponent(userId)}&start_date=not.is.null&order=created_at.desc&limit=60`;
    const res = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) throw new Error(`trips ${res.status}`);
    const trips = (await res.json()) as SavedTrip[];
    return new Response(buildFeed(trips), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="backline-trips.ics"',
        "Cache-Control": "private, max-age=900",
      },
    });
  } catch (err) {
    console.error("[calendar] feed failed", err instanceof Error ? err.message : err);
    return new Response("Try again shortly", { status: 503, headers: { "Retry-After": "300" } });
  }
}
