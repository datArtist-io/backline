// Places a booking call for the next place when one didn't connect, so a booking never dead-ends.
// Demo mode (the default) rings the signed-in person's own phone; real businesses only with CALLS_LIVE=1.
import { z } from "zod";
import { callInstructions, createContext, toE164 } from "@backline/engine";
import { clientIp, rateLimiter } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { DIAL, underDailyCap } from "@/lib/demo-calls";
import { loadAccount } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(12);
const body = z.object({
  placeName: z.string().min(1).max(120),
  opening: z.string().min(1).max(400),
  brief: z.string().min(1).max(700),
  /** The business's own number, used only when live calling is switched on. */
  to: z.string().max(30).nullable().optional(),
  /** The person's phone, for demo calls. */
  phone: z.string().max(30).nullable().optional(),
  client: z.string().max(80).nullable().optional(),
});

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many calls. Wait a moment." }, { status: 429 });
  const session = await getSession().catch(() => null);
  if (!session) return Response.json({ error: "Sign in to place calls." }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That call request isn't complete." }, { status: 400 });
  const b = parsed.data;
  const ctx = createContext(process.env, { signal: req.signal });
  if (!ctx.calls) return Response.json({ error: "Calling isn't connected." }, { status: 503 });
  const cc = DIAL[(req.headers.get("x-vercel-ip-country") ?? "").toUpperCase()];
  // Demo calls ring the person's own phone: the one saved on their account wins over anything sent.
  const saved = ctx.callsLive ? null : await loadAccount(session).then((a) => a.profile.phone ?? null).catch(() => null);
  const target = ctx.callsLive ? toE164(b.to ?? null, cc) : toE164(saved ?? b.phone ?? null, cc);
  if (!target) return Response.json({ error: ctx.callsLive ? "That place has no phone number." : "Add your phone number for the demo call." }, { status: 400 });
  if (!ctx.callsLive && !underDailyCap(session.user.id)) return Response.json({ error: "That's today's demo calls used up." }, { status: 429 });
  const client = b.client?.trim() || session.user.name || "my client";
  try {
    const started = await ctx.calls.start(
      {
        to: target,
        owner: session.user.id,
        businessName: b.placeName,
        firstMessage: b.opening.slice(0, 400),
        instructions: callInstructions({ placeName: b.placeName, callBrief: b.brief } as Parameters<typeof callInstructions>[0], client),
      },
      req.signal
    );
    return Response.json({ id: started.id, demo: !ctx.callsLive }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[calls] next call failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't place that call." }, { status: 502 });
  }
}
