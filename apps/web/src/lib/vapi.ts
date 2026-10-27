// "Call Backline": a phone number anyone can ring to plan a trip by voice. Vapi answers the call,
// asks for this assistant (assistant-request), and calls the plan_trip tool once it knows where,
// how long, who and what the caller loves. The trip then builds on the site from that sentence.
// Server only: uses VAPI_API_KEY. Nothing about the caller is stored by Backline; the call list
// comes from Vapi and the site shows only a 4-digit code and the trip, never the caller's number.
import { createHash } from "node:crypto";

const BASE = "https://api.vapi.ai";
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://backline-beta-one.vercel.app").replace(/\/$/, "");
export const INBOUND_PATH = "/api/vapi/inbound";

export const vapiReady = () => Boolean(process.env.VAPI_API_KEY);

export async function vapi<T = Record<string, unknown>>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(12000);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY ?? ""}`, "Content-Type": "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Vapi ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  return res.json() as Promise<T>;
}

export type CallTrip = { destination: string; days: number | null; travellers: number | null; loves: string | null; when: string | null; from: string | null; email: string | null };

const clean = (v: unknown, n = 80) => (typeof v === "string" && v.trim() ? v.replace(/[\r\n<>]+/g, " ").trim().slice(0, n) : null);
const count = (v: unknown, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.min(max, Math.round(n)) : null;
};

/** The tool's arguments, checked. Pure. */
export function tripArgs(raw: unknown): CallTrip | null {
  let x = raw;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const destination = clean(o.destination, 60);
  if (!destination) return null;
  const email = clean(o.email, 120)?.replace(/\s+/g, "").toLowerCase() ?? null;
  return {
    destination,
    days: count(o.days, 14),
    travellers: count(o.travellers, 12),
    loves: clean(o.loves, 160),
    when: clean(o.when, 40),
    from: clean(o.from, 60),
    email: email && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : null,
  };
}

/** The sentence the site plans from, the same way a typed request works. Pure. */
export function goalOf(t: CallTrip): string {
  const parts = [`${t.days ?? 3} days in ${t.destination} for ${t.travellers ?? 2}`];
  if (t.loves) parts.push(t.loves);
  if (t.when) parts.push(t.when);
  if (t.from) parts.push(`from ${t.from}`);
  return parts.join(", ");
}

export const tripUrl = (t: CallTrip) => `${SITE}/mission?${new URLSearchParams({ goal: goalOf(t), mode: "auto" })}`;

/** A 4-digit code for the call, the same every time for the same call. Pure. */
export function tripCode(callId: string): string {
  return String(parseInt(createHash("sha256").update(`backline:${callId}`).digest("hex").slice(0, 8), 16) % 10000).padStart(4, "0");
}

/** The plan_trip arguments from a call record, wherever Vapi keeps the messages. Pure. */
export function tripFromCall(call: Record<string, unknown>): CallTrip | null {
  const lists = [call.messages, (call.artifact as Record<string, unknown> | undefined)?.messages];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const m of list as Record<string, unknown>[]) {
      const calls = (m.toolCalls ?? m.tool_calls) as Record<string, unknown>[] | undefined;
      if (!Array.isArray(calls)) continue;
      for (const c of calls) {
        const fn = c.function as { name?: string; arguments?: unknown } | undefined;
        if (fn?.name === "plan_trip") {
          const t = tripArgs(fn.arguments);
          if (t) return t;
        }
      }
    }
  }
  return null;
}

const SYSTEM = `You are Backline, an AI travel agent answering the phone. Backline plans trips around what people love, using Qloo's taste data, then books and pays for everything.
Say once, early, that you're an AI agent. Be warm, quick and natural. One short question at a time, and let the caller talk.
Your job on this call: plan a trip. You need where they want to go. Also useful: how many days, how many people, what they love (artists, music, food, fashion, films, brands, a vibe: this is what makes the trip theirs), roughly when, and which city they'd travel from.
Ask at most three questions in total. If they already gave enough, don't ask more. If they don't know something, use a sensible default and move on.
Before planning, ask if they'd like the link emailed. If yes, ask them to spell the email address, then read it back once to check.
Then call plan_trip. While it works, say something short like "Building it now."
When plan_trip returns, tell them the trip code digit by digit, and that their trip is on the Backline website in the "Call Backline" section, where it's already being built: the taste match, the plan on a 3D map and the bookings. If the email was sent, say so. Offer one line on what Backline does next (it can book and pay for the whole trip in one tap), then thank them and end the call.
Never ask for card, bank, ID, passport or password details, and never agree to any payment on the call. If they're not interested, or it's a wrong number, apologise briefly and end the call. Keep the whole call under four minutes.`;

/** The assistant Backline answers with. */
const WEB = `This call is happening in the caller's web browser, on the Backline website, so they can see their screen.
Don't ask whether they want the link emailed and don't read out a code: when plan_trip returns, tell them their trip is opening on their screen right now, with the taste match, the plan on a 3D map and the bookings. Then thank them and end the call.`;

/** Who the agent is talking to, and where: a phone call to the Backline number or a call in the browser. */
export type CallKind = "inbound" | "web";
export const isBacklineCall = (c: Record<string, unknown> | null | undefined): boolean => {
  const meta = ((c?.assistant as Record<string, unknown> | undefined)?.metadata ?? {}) as { app?: string; kind?: string };
  return Boolean(c && meta.app === "backline" && ((c.type === "inboundPhoneCall" && meta.kind === "inbound") || (c.type === "webCall" && meta.kind === "web")));
};

export function inboundAssistant(kind: CallKind = "inbound") {
  return {
    name: "Backline",
    firstMessage: "Hi, you've reached Backline, the AI travel agent. Where do you want to go?",
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: process.env.VAPI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      maxTokens: 220,
      messages: [{ role: "system", content: kind === "web" ? `${SYSTEM}\n${WEB}` : SYSTEM }],
      tools: [
        {
          type: "function",
          async: false,
          function: {
            name: "plan_trip",
            description: "Start building the caller's trip on the Backline website. Call once you know at least the destination.",
            parameters: {
              type: "object",
              properties: {
                destination: { type: "string", description: "City or place, e.g. Lisbon" },
                days: { type: "number", description: "Number of days" },
                travellers: { type: "number", description: "Number of people" },
                loves: { type: "string", description: "What they love, in their words: artists, music, food, style, brands, a vibe" },
                when: { type: "string", description: "Roughly when, in their words, e.g. next month or mid December" },
                from: { type: "string", description: "City they'd travel from" },
                email: { type: "string", description: "Their email, only if they asked for the link by email and confirmed the spelling" },
              },
              required: ["destination"],
            },
          },
          messages: [{ type: "request-start", content: "Building it now." }],
          server: { url: `${SITE}${INBOUND_PATH}` },
        },
      ],
    },
    transcriber: { provider: "deepgram", model: "nova-3", language: "en" },
    endCallFunctionEnabled: true,
    maxDurationSeconds: 300,
    silenceTimeoutSeconds: 30,
    metadata: { app: "backline", kind },
  };
}
