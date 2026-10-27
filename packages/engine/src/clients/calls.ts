// Places AI phone calls on the user's behalf through Vapi, only after the user approves them.
// The caller always says it's an AI assistant calling for the user, never gives payment details,
// and asks for a callback when a business needs the person themselves.
import { UpstreamError } from "../errors";

export type CallRequest = {
  to: string; // E.164, e.g. +2348012345678
  /** Who placed it (their user id), so only they can see or retry it. */
  owner?: string | null;
  businessName: string;
  firstMessage: string;
  instructions: string;
};
export type CallOutcome = "live" | "talked" | "no_answer" | "busy" | "voicemail" | "no_audio" | "failed";
export type CallStatus = {
  id: string;
  status: string;
  ended: boolean;
  summary: string | null;
  transcript: string | null;
  endedReason: string | null;
  /** What happened, in one word the UI can act on. */
  outcome: CallOutcome;
  /** The same call is worth placing again (it never really connected). */
  retryable: boolean;
};

/** What a Vapi ended reason means for the person. Pure. */
export function callOutcome(status: string, endedReason: string | null, transcript: string | null): CallOutcome {
  if (status !== "ended") return "live";
  const r = (endedReason ?? "").toLowerCase();
  if (/did-not-receive-customer-audio|did not receive customer audio/.test(r)) return "no_audio";
  if (/no-answer|did-not-answer|not-answer/.test(r)) return "no_answer";
  if (/busy/.test(r)) return "busy";
  if (/voicemail/.test(r)) return "voicemail";
  if (/error|failed|start\.error|providerfault|sip-/.test(r)) return "failed";
  // Ended normally: it only counts as a conversation if someone other than the assistant spoke.
  return transcript && /\b(user|customer)\s*:/i.test(transcript) ? "talked" : r.includes("customer-ended") || r.includes("assistant-ended") ? "talked" : "failed";
}

/** The outcome in plain words. Pure. */
export function outcomeText(o: CallOutcome): string {
  return {
    live: "On the call now",
    talked: "Call finished",
    no_answer: "No one picked up",
    busy: "The line was busy",
    voicemail: "Went to voicemail, so I left a message asking them to call back",
    no_audio: "The call connected but no sound came through from their side, so it dropped",
    failed: "The call couldn't go through",
  }[o];
}

export interface CallPlacer {
  start(call: CallRequest, signal?: AbortSignal): Promise<{ id: string }>;
  status(id: string, signal?: AbortSignal): Promise<CallStatus>;
  /** Place the same call again (same number, same assistant). Only for the person who placed it. */
  retry?(id: string, owner: string, signal?: AbortSignal): Promise<{ id: string }>;
}

export const E164_RE = /^\+[1-9]\d{7,14}$/;

/** Normalise a phone number to E.164 where possible. Pure. */
export function toE164(raw: string | null | undefined, defaultCountryCode?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    if (!defaultCountryCode) return null;
    digits = `+${defaultCountryCode}${digits.replace(/^0+/, "")}`;
  }
  return E164_RE.test(digits) ? digits : null;
}

export class VapiCaller implements CallPlacer {
  private readonly base = "https://api.vapi.ai";
  constructor(private readonly config: { apiKey: string; phoneNumberId: string; model?: string }) {
    if (!config.apiKey || !config.phoneNumberId) throw new Error("VapiCaller requires an API key and a phone number id");
  }

  private async req(path: string, init: RequestInit, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(15000);
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch((err: Error) => {
      throw new UpstreamError("calls", null, `Vapi network error: ${err.message}`, "The call couldn't be placed. Try again.");
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new UpstreamError("calls", res.status, `Vapi returned ${res.status}: ${detail}`, "The call couldn't be placed. Check the calling settings.");
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  async start(call: CallRequest, signal?: AbortSignal): Promise<{ id: string }> {
    if (!E164_RE.test(call.to)) throw new UpstreamError("calls", 400, "Invalid number", "That phone number doesn't look right.");
    const data = await this.req(
      "/call",
      {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: this.config.phoneNumberId,
          customer: { number: call.to, name: call.businessName.slice(0, 40) },
          assistant: {
            firstMessage: call.firstMessage,
            model: { provider: "openai", model: this.config.model || "gpt-4o-mini", messages: [{ role: "system", content: call.instructions }] },
            endCallFunctionEnabled: true,
            maxDurationSeconds: 300,
            metadata: { app: "backline", owner: call.owner ?? null },
          },
        }),
      },
      signal
    );
    return { id: String(data.id ?? "") };
  }

  async status(id: string, signal?: AbortSignal): Promise<CallStatus> {
    const d = await this.req(`/call/${encodeURIComponent(id)}`, { method: "GET" }, signal);
    const analysis = (d.analysis ?? {}) as { summary?: string };
    const artifact = (d.artifact ?? {}) as { transcript?: string };
    const status = String(d.status ?? "unknown");
    const transcript = ((artifact.transcript ?? (d.transcript as string | undefined)) || null)?.slice(0, 6000) ?? null;
    const endedReason = (d.endedReason as string | undefined) ?? null;
    const outcome = callOutcome(status, endedReason, transcript);
    return {
      id,
      status,
      outcome,
      retryable: ["no_audio", "no_answer", "busy", "failed"].includes(outcome),
      ended: status === "ended",
      summary: (analysis.summary ?? (d.summary as string | undefined) ?? null) || null,
      transcript,
      endedReason,
    };
  }

  async retry(id: string, owner: string, signal?: AbortSignal): Promise<{ id: string }> {
    const d = await this.req(`/call/${encodeURIComponent(id)}`, { method: "GET" }, signal);
    const assistant = d.assistant as Record<string, unknown> | undefined;
    const meta = (assistant?.metadata ?? {}) as { app?: string; owner?: string | null };
    if (!assistant || meta.app !== "backline" || !meta.owner || meta.owner !== owner) throw new UpstreamError("calls", 403, "Not this person's call", "That call can't be placed again from here.");
    const customer = d.customer as { number?: string; name?: string } | undefined;
    if (!customer?.number || !E164_RE.test(customer.number)) throw new UpstreamError("calls", 400, "No number on the call", "That call can't be placed again.");
    const again = await this.req(
      "/call",
      { method: "POST", body: JSON.stringify({ phoneNumberId: this.config.phoneNumberId, customer: { number: customer.number, name: customer.name }, assistant }) },
      signal
    );
    return { id: String(again.id ?? "") };
  }
}
