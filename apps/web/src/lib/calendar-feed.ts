// A live calendar for each signed-in traveller: one private link their calendar app subscribes to
// once (Google, Apple, Outlook). Every trip they plan is saved to their account, and the feed lists
// those trips, so new and changed plans appear in the calendar by themselves.
//
// The link carries the person's id and an HMAC of it under a server-only key, so it can't be guessed
// or forged for someone else, and nothing new is stored. buildFeed is pure, so it is tested.
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseTime } from "./ics";
import type { SavedTrip } from "./account";

function key(): string | null {
  const k = process.env.RUN_SEAL_KEY || process.env.SUPABASE_SECRET_KEY || process.env.TRAVEL_DOCS_KEY || "";
  return k.length >= 16 ? `backline-calendar:${k}` : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sign = (k: string, id: string) => createHmac("sha256", k).update(id).digest("base64url").slice(0, 32);

/** "<user id>.<signature>", or null when the server has no key to sign with. */
export function feedToken(userId: string): string | null {
  const k = key();
  return k && UUID.test(userId) ? `${userId}.${sign(k, userId)}` : null;
}

/** The user id a link belongs to, or null when it is malformed or forged. */
export function openFeedToken(token: string): string | null {
  const k = key();
  const [id, given] = token.split(".");
  if (!k || !id || !given || !UUID.test(id)) return null;
  const want = Buffer.from(sign(k, id));
  const got = Buffer.from(given);
  return got.length === want.length && timingSafeEqual(got, want) ? id : null;
}

type FeedTrip = Pick<SavedTrip, "id" | "title" | "destination" | "start_date" | "end_date" | "details" | "created_at">;

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const pad = (n: number) => String(n).padStart(2, "0");
const at = (ymd: string, h: number, m: number) => `${ymd}T${pad(h)}${pad(m)}00`;

/** RFC 5545 folds lines longer than 75 octets. */
function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/**
 * The traveller's trips as one calendar. Asking for the same trip twice saves it twice, so only the
 * newest plan per destination and start date is kept. Event ids stay the same from one refresh to the
 * next, so a calendar app updates events in place instead of piling up copies.
 */
export function buildFeed(trips: FeedTrip[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const newest = new Map<string, FeedTrip>();
  for (const t of [...trips].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!t.start_date || (t.end_date ?? t.start_date) < cutoff) continue;
    const k = `${(t.destination || t.title).toLowerCase()}|${t.start_date}`;
    if (!newest.has(k)) newest.set(k, t);
  }
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Backline//Trips//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Backline trips",
    "X-WR-CALDESC:Every trip you plan with Backline. Updates by itself.",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const t of newest.values()) {
    const where = t.destination ?? "";
    (t.details?.days ?? []).forEach((day, di) => {
      if (!day.date || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return;
      const ymd = day.date.replace(/-/g, "");
      const timed = day.items.map((it) => ({ it, t: parseTime(it.time ?? "") }));
      timed.forEach(({ it, t: time }, ii) => {
        if (!it.title) return;
        lines.push("BEGIN:VEVENT", `UID:${t.id}-${di}-${ii}@backline`, `DTSTAMP:${stamp}`);
        if (time) {
          // Until the next stop of the day, between 30 minutes and 3 hours; an hour when it's the last.
          const next = timed.slice(ii + 1).find((x) => x.t)?.t;
          const start = time[0] * 60 + time[1];
          const span = next ? Math.min(180, Math.max(30, next[0] * 60 + next[1] - start)) : 60;
          const end = Math.min(23 * 60 + 59, start + span);
          lines.push(`DTSTART:${at(ymd, time[0], time[1])}`, `DTEND:${at(ymd, Math.floor(end / 60), end % 60)}`);
        } else {
          lines.push(`DTSTART;VALUE=DATE:${ymd}`);
        }
        lines.push(`SUMMARY:${esc(it.title)}`);
        if (where) lines.push(`LOCATION:${esc(where)}`);
        lines.push(`DESCRIPTION:${esc(`${t.title}${day.label ? ` · ${day.label}` : ""}\nPlanned with Backline`)}`, "END:VEVENT");
      });
    });
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n");
}

/** Links that subscribe a calendar app to the feed. */
export function subscribeLinks(feedUrl: string): { google: string; webcal: string } {
  const webcal = feedUrl.replace(/^https?:\/\//, "webcal://");
  return { google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`, webcal };
}
