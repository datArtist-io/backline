// Builds a calendar file (.ics) for a whole plan, so every stop lands in the user's calendar.
import type { Place, TripPlanOutput } from "@backline/engine";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** "09:30" or "9:30 pm" → [hours, minutes], or null. */
export function parseTime(t: string): [number, number] | null {
  const m = t.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h < 24 && min < 60 ? [h, min] : null;
}

export function buildIcs(title: string, plan: TripPlanOutput, places: Map<string, Place>): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Backline//Plan//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(title)}`];
  let n = 0;
  for (const day of plan.days) {
    if (!day.date) continue;
    const ymd = day.date.replace(/-/g, "");
    for (const it of day.items) {
      const t = parseTime(it.time);
      const p = it.placeId ? places.get(it.placeId) : undefined;
      n += 1;
      lines.push("BEGIN:VEVENT", `UID:backline-${ymd}-${n}@backline`, `DTSTAMP:${stamp()}`);
      if (t) {
        const start = `${ymd}T${String(t[0]).padStart(2, "0")}${String(t[1]).padStart(2, "0")}00`;
        const endH = Math.min(23, t[0] + 1);
        lines.push(`DTSTART:${start}`, `DTEND:${ymd}T${String(endH).padStart(2, "0")}${String(t[1]).padStart(2, "0")}00`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      }
      lines.push(`SUMMARY:${esc(it.title)}`);
      if (p) lines.push(`LOCATION:${esc(p.address ? `${p.name}, ${p.address}` : p.name)}`);
      if (p?.lat != null && p?.lon != null) lines.push(`GEO:${p.lat.toFixed(6)};${p.lon.toFixed(6)}`);
      const desc = [it.note, p?.phone ? `Phone: ${p.phone}` : null, p?.website].filter(Boolean).join("\n");
      if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
      lines.push("END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 wants CRLF line endings.
  return lines.join("\r\n");
}
