// Sending the whole plan to the traveller's own chat apps and inbox: one plain-text message built from
// the trip, then a WhatsApp or Telegram share link (the app opens with the text ready to send, to
// themselves or anyone) or an email. Pure, so it is tested; nothing here sends anything by itself.

/** The parts of a trip a message needs (from export.outline). */
export type ShareTrip = {
  title: string;
  chips: string[];
  summary?: string;
  days: { heading: string; date: string; items: { time: string | null; title: string }[] }[];
  budget: { item: string; amount: string }[];
  tips: string[];
};

/** Room in a share link: WhatsApp and Telegram take long messages, but browsers and phones cut long URLs. */
export const SHARE_MAX = 3000;
/** Email bodies can be longer. */
export const EMAIL_MAX = 7500;

/** The plan as a message: title, the days hour by hour, the budget and tips, then where it came from. */
export function tripMessage(t: ShareTrip, site: string, max = SHARE_MAX): string {
  const head = [`✈️ ${t.title}`, t.chips.filter(Boolean).join(" · ")].filter(Boolean);
  const days = t.days.map((d) =>
    [`*${d.heading}*${d.date ? ` (${d.date})` : ""}`, ...d.items.map((it) => `${it.time ? `${it.time}  ` : "• "}${it.title}`)].join("\n"),
  );
  const budget = t.budget.length ? ["*Budget*", ...t.budget.map((b) => `${b.item}: ${b.amount}`)].join("\n") : "";
  const tips = t.tips.length ? ["*Tips*", ...t.tips.slice(0, 3).map((x) => `• ${x}`)].join("\n") : "";
  const foot = `Planned with Backline · ${site}`;
  const parts = [head.join("\n"), t.summary ?? "", ...days, budget, tips].filter(Boolean);
  // Keep whole sections while they fit; say so when the rest is left out.
  const out: string[] = [];
  let used = foot.length + 2;
  for (const p of parts) {
    const extra = p.length + 2;
    if (used + extra > max) {
      out.push(`…and more in the full plan on Backline.`);
      break;
    }
    out.push(p);
    used += extra;
  }
  return [...out, foot].join("\n\n");
}

/** WhatsApp opens with the message ready; the traveller picks a chat (their own "Message yourself" included). */
export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Telegram's share screen needs a link; the plan goes in as the text. */
export const telegramUrl = (link: string, text: string) => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;

/** The traveller's own mail app, for when they aren't signed in. */
export const mailtoUrl = (subject: string, body: string) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Message markup for email: WhatsApp's *bold* stars read as clutter in plain-text mail. */
export const plainText = (text: string) => text.replace(/\*([^*\n]+)\*/g, "$1");
