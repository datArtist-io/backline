// Status of a call the agent placed: whether it's ringing, in progress or done, and what was agreed.
import { createContext } from "@backline/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) return Response.json({ error: "Unknown call." }, { status: 400 });
  try {
    const ctx = createContext(process.env, { signal: req.signal });
    if (!ctx.calls) return Response.json({ error: "Calling isn't connected." }, { status: 503 });
    const status = await ctx.calls.status(id, req.signal);
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[calls] status failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't check the call just now." }, { status: 502 });
  }
}
