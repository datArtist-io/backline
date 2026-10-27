// "Call me now": a visitor types their own number and Backline's AI agent calls it within seconds,
// to show the calls are real. Opt-in only (a consent tick), short (2 minutes at most), and limited per
// visitor, per number and per day, so it can't be used to bother anyone. GET follows the call's state.
import { z } from "zod";
import { createContext, toE164 } from "@backline/engine";
import { clientIp } from "@/lib/rate-limit";
import { DIAL } from "@/lib/demo-calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const day = () => new Date().toISOString().slice(0, 10);
const perIp = new Map<string, { day: string; n: number }>();
const perNumber = new Map<string, string>();
const global = { day: "", n: 0 };
const DAILY = Number(process.env.DEMO_CALLS_PER_DAY ?? 60) || 60;

function allow(ip: string, number: string): string | null {
  const d = day();
  if (global.day !== d) Object.assign(global, { day: d, n: 0 });
  if (global.n >= DAILY) return "Today's demo calls are all used. Try again tomorrow.";
  if (perNumber.get(number) === d) return "That number already had its demo call today.";
  const e = perIp.get(ip);
  const n = e && e.day === d ? e.n : 0;
  if (n >= 2) return "That's two demo calls from here today. Try again tomorrow.";
  perIp.set(ip, { day: d, n: n + 1 });
  perNumber.set(number, d);
  global.n += 1;
  return null;
}

const body = z.object({ phone: z.string().min(6).max(30), consent: z.literal(true), name: z.string().max(60).optional() });

const INSTRUCTIONS = (name: string | null) => [
  "You are Backline's AI booking agent, on a short live demo call. The person asked for this call on backline-beta-one.vercel.app and agreed to it.",
  "Be warm, quick and natural, like a great concierge. Speak in short sentences, one idea at a time, and let them talk.",
  "Explain in one or two lines what Backline does: you say where you're going, Backline reads your taste with Qloo, plans the whole trip on a 3D map, then pays from your wallet and calls hotels and restaurants to book, like this call.",
  `Then offer a 30-second role-play: they pretend to be a restaurant, and you book a table for two this Friday at 8pm${name ? ` under ${name}` : ""}. Ask for availability, confirm the time, read it back once.`,
  "If they say this wasn't them, that they didn't ask, or to stop: apologise briefly, say you won't call again, and end the call at once.",
  "Never ask for card, bank, ID or account details, and never agree to any charge. Keep the whole call under two minutes, then thank them and end the call.",
].join("\n");

export async function POST(req: Request) {
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Add your number and tick the box to agree to the call." }, { status: 400 });
  const ctx = createContext(process.env, { signal: req.signal });
  if (!ctx.calls) return Response.json({ error: "Calling isn't connected right now." }, { status: 503 });
  const to = toE164(p.data.phone, DIAL[(req.headers.get("x-vercel-ip-country") ?? "").toUpperCase()]);
  if (!to) return Response.json({ error: "That number doesn't look right. Include your country code, e.g. +234…" }, { status: 400 });
  const blocked = allow(clientIp(req), to);
  if (blocked) return Response.json({ error: blocked }, { status: 429 });
  const name = p.data.name?.trim().replace(/[^\p{L}\p{M}' .-]/gu, "").slice(0, 40) || null;
  try {
    const started = await ctx.calls.start(
      {
        to,
        owner: null,
        businessName: "Backline demo",
        firstMessage: `Hi${name ? ` ${name}` : ""}! This is Backline's AI booking agent. You asked for a demo call on our site, so here I am. Got a minute?`,
        instructions: INSTRUCTIONS(name),
        maxSeconds: 120,
      },
      req.signal
    );
    return Response.json({ id: started.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[demo-call] failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "The call couldn't be placed just now. Try again in a minute." }, { status: 502 });
  }
}

/** Just the state of a demo call this server placed: ringing, on the call, or finished. No transcript. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{20,64}$/i.test(id)) return Response.json({ state: "unknown" });
  const ctx = createContext(process.env, { signal: req.signal });
  const st = await ctx.calls?.status(id, req.signal).catch(() => null);
  if (!st) return Response.json({ state: "unknown" });
  return Response.json({ state: st.ended ? "ended" : st.status === "in-progress" ? "talking" : "ringing", outcome: st.ended ? st.outcome : null });
}
