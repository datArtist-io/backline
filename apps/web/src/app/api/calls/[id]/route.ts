// Status of a call the agent placed: whether it's ringing, in progress or done, and what was agreed.
// Only the person who placed it can ask, since a transcript can hold what someone booked and for whom.
import { createContext } from "@backline/engine";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseConfig } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A call is followed every few seconds for about ten minutes, so the limit allows for that.
const rateLimited = rateLimiter(40);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many checks. Wait a moment." }, { status: 429 });
  const session = supabaseConfig() ? await getSession().catch(() => null) : null;
  if (supabaseConfig() && !session) return Response.json({ error: "Sign in to see your calls." }, { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return Response.json({ error: "Unknown call." }, { status: 400 });
  try {
    const ctx = createContext(process.env, { signal: req.signal });
    if (!ctx.calls) return Response.json({ error: "Calling isn't connected." }, { status: 503 });
    const { owner, ...status } = await ctx.calls.status(id, req.signal);
    // A transcript is only for the person who placed the call.
    if (session && owner && owner !== session.user.id) return Response.json({ error: "Unknown call." }, { status: 404 });
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[calls] status failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't check the call just now." }, { status: 502 });
  }
}

/** Place the same call again, after one that never really connected. Only for the person who placed it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many tries. Wait a moment." }, { status: 429 });
  const session = await getSession().catch(() => null);
  if (!session) return Response.json({ error: "Sign in to place calls." }, { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return Response.json({ error: "Unknown call." }, { status: 400 });
  try {
    const ctx = createContext(process.env, { signal: req.signal });
    if (!ctx.calls?.retry) return Response.json({ error: "Calling isn't connected." }, { status: 503 });
    const again = await ctx.calls.retry(id, session.user.id, req.signal);
    return Response.json(again, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calls] retry failed", msg);
    const user = (err as { userMessage?: string }).userMessage;
    return Response.json({ error: user ?? "Couldn't place the call again." }, { status: 502 });
  }
}
