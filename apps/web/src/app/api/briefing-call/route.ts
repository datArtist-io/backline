// The concierge call: once the whole trip is booked and paid, Backline rings the traveller (their own
// saved phone, never anyone else) and talks them through it: flights, hotel, tables, what's next.
// The agent only states what's in the briefing it was given. GET follows the call's state.
import { z } from "zod";
import { createContext, toE164 } from "@backline/engine";
import { getSession } from "@/lib/session";
import { loadAccount } from "@/lib/account";
import { DIAL } from "@/lib/demo-calls";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimited = rateLimiter(4);
const perUser = new Map<string, { day: string; n: number }>();
const body = z.object({
  where: z.string().max(80).nullable().optional(),
  lines: z.array(z.string().min(2).max(200)).min(1).max(16),
});

const tidy = (s: string) => s.replace(/[\r\n<>]+/g, " ").replace(/\s+/g, " ").trim();

function instructions(name: string | null, where: string | null, lines: string[]): string {
  return [
    `You are Backline's concierge, calling ${name ?? "the traveller"} with the briefing for their ${where ? `trip to ${where}` : "trip"}, which Backline has just booked and paid for. They asked Backline to plan and book it.`,
    "Say you're Backline's AI concierge. Sound warm and unhurried, like a great hotel concierge. Short sentences.",
    "Ask if now is a good time for a one-minute rundown. If not, say the details are all in the app and end the call.",
    "Then walk through the trip in time order: getting there, where they're staying, the tables and tickets booked, getting around, and the flight home. Turn the notes into natural speech: say times like 'ten forty in the morning', skip reference codes unless asked, and don't read amounts unless asked.",
    "Only use the facts below. If they ask something that isn't there, say it's in the Backline app. Never invent times, places or prices.",
    "Never ask for card, bank, ID or password details. End by wishing them a great trip, then end the call. Keep it under three minutes.",
    "",
    "Briefing:",
    ...lines.map((l) => `- ${l}`),
  ].join("\n");
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many calls. Wait a moment." }, { status: 429 });
  const session = await getSession().catch(() => null);
  if (!session) return Response.json({ error: "Sign in to get a briefing call." }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "There's nothing booked to brief you on yet." }, { status: 400 });
  const ctx = createContext(process.env, { signal: req.signal });
  if (!ctx.calls) return Response.json({ error: "Calling isn't connected right now." }, { status: 503 });
  const account = await loadAccount(session).catch(() => null);
  const to = toE164(account?.profile.phone ?? null, DIAL[(req.headers.get("x-vercel-ip-country") ?? "").toUpperCase()]);
  if (!to) return Response.json({ error: "Add your phone number in Account to get the briefing call.", needsPhone: true }, { status: 400 });
  const day = new Date().toISOString().slice(0, 10);
  const u = perUser.get(session.user.id);
  const n = u && u.day === day ? u.n : 0;
  if (n >= 4) return Response.json({ error: "That's today's briefing calls used." }, { status: 429 });
  perUser.set(session.user.id, { day, n: n + 1 });
  const first = account?.profile.firstName?.trim() || session.user.name?.split(" ")[0] || null;
  const where = p.data.where ? tidy(p.data.where) : null;
  try {
    const started = await ctx.calls.start(
      {
        to,
        owner: session.user.id,
        businessName: "Your trip briefing",
        firstMessage: `Hi${first ? ` ${first}` : ""}, it's your Backline concierge. Your ${where ? `${where} trip` : "trip"} is all booked and paid. Got a minute for the rundown?`,
        instructions: instructions(first, where, p.data.lines.map(tidy)),
        maxSeconds: 210,
      },
      req.signal
    );
    return Response.json({ id: started.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[briefing-call] failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "The briefing call couldn't be placed. Try again in a minute." }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const session = await getSession().catch(() => null);
  if (!session) return Response.json({ state: "unknown" });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{20,64}$/i.test(id)) return Response.json({ state: "unknown" });
  const ctx = createContext(process.env, { signal: req.signal });
  const st = await ctx.calls?.status(id, req.signal).catch(() => null);
  if (!st) return Response.json({ state: "unknown" });
  return Response.json({ state: st.ended ? "ended" : st.status === "in-progress" ? "talking" : "ringing", outcome: st.ended ? st.outcome : null });
}
