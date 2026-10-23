// Sends emails on the user's behalf through Resend, only after the user approves them.
// Replies go to the user's own address (reply-to), so the conversation continues in their inbox.
import { UpstreamError } from "../errors";

export type OutgoingEmail = { to: string; subject: string; text: string; replyTo?: string; cc?: string };
export interface EmailSender {
  readonly from: string;
  send(mail: OutgoingEmail, signal?: AbortSignal): Promise<{ id: string }>;
}

export const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export class ResendSender implements EmailSender {
  constructor(private readonly config: { apiKey: string; from: string }) {
    if (!config.apiKey || !config.from) throw new Error("ResendSender requires an API key and a from address");
  }
  get from() {
    return this.config.from;
  }
  async send(mail: OutgoingEmail, signal?: AbortSignal): Promise<{ id: string }> {
    if (!EMAIL_RE.test(mail.to)) throw new UpstreamError("email", 400, "Invalid recipient", "That email address doesn't look right.");
    const timeout = AbortSignal.timeout(15000);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.config.from,
        to: [mail.to],
        subject: mail.subject.slice(0, 200),
        text: mail.text.slice(0, 8000),
        ...(mail.replyTo && EMAIL_RE.test(mail.replyTo) ? { reply_to: mail.replyTo } : {}),
        ...(mail.cc && EMAIL_RE.test(mail.cc) ? { cc: [mail.cc] } : {}),
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    }).catch((err: Error) => {
      throw new UpstreamError("email", null, `Resend network error: ${err.message}`, "The email couldn't be sent. Try again.");
    });
    if (!res.ok) throw new UpstreamError("email", res.status, `Resend returned ${res.status}`, "The email couldn't be sent. Check the email settings.");
    const data = (await res.json()) as { id?: string };
    return { id: data.id ?? "sent" };
  }
}
