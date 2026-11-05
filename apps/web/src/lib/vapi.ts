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

export const GREETING = "Hey! I'm your Backline agent, an AI that plans and books your whole trip. Where are you thinking of going?";

/** How the agent opens: on the phone it waits for the caller's first words; in the browser it greets first. */
const OPENING = {
  inbound: `The call starts in silence. When the caller first speaks (usually "hello"), your first reply is exactly: "${GREETING}" If their first words already say where they want to go, greet them in one short line instead and carry on from what they said. Never greet or introduce yourself a second time.`,
  web: `You've already greeted the caller with: "${GREETING}" Never greet or introduce yourself again.`,
};

const SYSTEM = `You are Backline, an AI travel agent on a phone call. You plan trips around what people love, using Qloo's taste data.

How you talk: like a friendly, switched-on person at a great travel agency, not a form. Short spoken sentences, contractions, plain words. React to what they say ("Oh, Lisbon in spring, lovely."). One question at a time, then stop and listen. Never list options, never use bullet points, symbols or markdown, never read back everything they said. Say numbers the way people say them ("four days", "two of you"). You mentioned you're an AI in your greeting, so don't say it again unless asked.

Your job: get enough to plan the trip, then plan it. You need where they want to go. Nice to have: how long, how many people, roughly when, where they're flying from, and what they love (music, artists, food, fashion, films, a vibe). That last one is what makes the trip theirs, so ask for it if they haven't said.
Ask two or three questions at most. If they've already told you enough, don't ask more. If they don't know something, pick a sensible default and say it lightly ("I'll go with four days, you can change it").
Never ask for an email, phone number, card, bank, passport or password, and never take a payment on the call.

As soon as you have enough, call plan_trip. Don't announce it at length; the tool says a short line for you.
When plan_trip returns, say the line it gives you, word for word, and nothing else. That line gives the trip code and ends the call.
If plan_trip fails or gives no line, say: "Sorry, I couldn't start that one. Give it another try in a minute. Have an amazing trip. Bye!"
If it's a wrong number or they're not interested, say sorry and finish with "Have an amazing trip. Bye!"`;

/** The assistant Backline answers with. */
const WEB = `This call is in the caller's web browser, on the Backline website, so they can see their screen.
When plan_trip returns, say the line it gives you, word for word, and nothing else.`;

/** Who the agent is talking to, and where: a phone call to the Backline number or a call in the browser. */
export type CallKind = "inbound" | "web";
export const isBacklineCall = (c: Record<string, unknown> | null | undefined): boolean => {
  const meta = ((c?.assistant as Record<string, unknown> | undefined)?.metadata ?? {}) as { app?: string; kind?: string };
  return Boolean(c && meta.app === "backline" && ((c.type === "inboundPhoneCall" && meta.kind === "inbound") || (c.type === "webCall" && meta.kind === "web")));
};

export function inboundAssistant(kind: CallKind = "inbound") {
  // Phone: pick up in silence and let the caller speak first (time to press record). The agent's
  // first reply is the greeting, written by the model, so it's in the conversation and never repeated.
  // (A timed greeting from a hook isn't in the model's history, and its timer can fire mid-call.)
  // The browser call greets straight away.
  const greeting = kind === "inbound" ? { firstMessageMode: "assistant-waits-for-user" } : { firstMessage: GREETING, firstMessageMode: "assistant-speaks-first" };
  return {
    name: "Backline",
    ...greeting,
    model: {
      provider: "openai",
      model: process.env.VAPI_MODEL || "gpt-4o-mini",
      temperature: 0.7,
      maxTokens: 220,
      messages: [{ role: "system", content: kind === "web" ? `${SYSTEM}\n${OPENING.web}\n${WEB}` : `${SYSTEM}\n${OPENING.inbound}` }],
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
              },
              required: ["destination"],
            },
          },
          messages: [{ type: "request-start", content: "Perfect, give me a second while I put that together." }],
          server: { url: `${SITE}${INBOUND_PATH}` },
        },
      ],
    },
    transcriber: { provider: "deepgram", model: "nova-3", language: "en" },
    // A chosen voice (e.g. VAPI_VOICE_PROVIDER=vapi, VAPI_VOICE_ID=<a voice from Vapi's dashboard>);
    // without both, Vapi's default voice.
    ...(process.env.VAPI_VOICE_PROVIDER && process.env.VAPI_VOICE_ID ? { voice: { provider: process.env.VAPI_VOICE_PROVIDER, voiceId: process.env.VAPI_VOICE_ID } } : {}),
    // Quick, polite turn-taking, the same as Backline's outbound calls: it answers promptly and stops
    // when the caller starts talking.
    startSpeakingPlan: { waitSeconds: 0.4 },
    stopSpeakingPlan: { numWords: 1, voiceSeconds: 0.2, backoffSeconds: 0.8 },
    // The call ends only when the agent has said its goodbye line, after it has finished saying it.
    // The end-call tool is off: gpt-4o-mini would call it straight after plan_trip, without a word,
    // so callers heard "give me a second" and then the line went dead.
    endCallPhrases: ["have an amazing trip"],
    endCallFunctionEnabled: false,
    maxDurationSeconds: 300,
    silenceTimeoutSeconds: 20,
    metadata: { app: "backline", kind },
  };
}
