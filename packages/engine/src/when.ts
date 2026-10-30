// When a trip happens, read from the request on the calendar, not by the model (models get weekdays,
// years and relative dates wrong). One reader for every way people write a date: exact dates in any
// common format, ranges, relative days, weekends, holidays, and how long they're staying. Pure.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const FULL_MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december)";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY = "(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)";
const ORD = "(?:st|nd|rd|th)?";
const TO = "\\s*(?:-|–|—|to|until|till|til|through|thru|and)\\s*";

export type When = {
  /** First day (YYYY-MM-DD), when the request fixes it. */
  start: string | null;
  /** Last day (YYYY-MM-DD), when the request fixes it. */
  end: string | null;
  /** Things worth telling the person about how the dates were read. */
  notes: string[];
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const valid = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCMonth() === m - 1 && x.getUTCDate() === d;
};
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
const dayOfWeek = (word: string) => WEEKDAYS.findIndex((w) => w.startsWith(word.slice(0, 3).toLowerCase()));
const nice = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The next time this month and day comes round, today included (no year given). */
function upcoming(m: number, d: number, today: string): string | null {
  const y = Number(today.slice(0, 4));
  for (const year of [y, y + 1]) if (valid(year, m, d) && iso(year, m, d) >= today) return iso(year, m, d);
  return null;
}
/** A date with an optional year: given years are kept as they are; without one, the next such day. */
function dated(m: number, d: number, y: number | null, today: string): string | null {
  if (y != null) {
    const year = y < 100 ? 2000 + y : y;
    return valid(year, m, d) ? iso(year, m, d) : null;
  }
  return upcoming(m, d, today);
}
/** The coming weekday (today counts unless "next"). */
function nextWeekday(target: number, today: string, next = false): string {
  let n = (target - weekday(today) + 7) % 7;
  if (next && n === 0) n = 7;
  return addDays(today, n);
}
/** Easter Sunday (Gregorian), by the anonymous algorithm. */
export function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}
/** The nth weekday of a month (n = -1 for the last). */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  if (n > 0) {
    const first = iso(y, m, 1);
    return addDays(first, ((wd - weekday(first) + 7) % 7) + 7 * (n - 1));
  }
  const last = iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return addDays(last, -((weekday(last) - wd + 7) % 7));
}
/** A holiday's dates this year, or next year if it has passed. */
function holiday(t: string, today: string): { start: string; end: string; name: string } | null {
  const y = Number(today.slice(0, 4));
  const pick = (f: (year: number) => { start: string; end: string }, name: string) => {
    for (const year of [y, y + 1]) {
      const r = f(year);
      if (r.end >= today) return { ...r, name };
    }
    return null;
  };
  if (/\bchristmas eve\b/.test(t)) return pick((yr) => ({ start: iso(yr, 12, 24), end: iso(yr, 12, 24) }), "Christmas Eve");
  if (/\bboxing day\b/.test(t)) return pick((yr) => ({ start: iso(yr, 12, 26), end: iso(yr, 12, 26) }), "Boxing Day");
  if (/\b(christmas|xmas)\b/.test(t)) return pick((yr) => ({ start: iso(yr, 12, 24), end: iso(yr, 12, 26) }), "Christmas");
  if (/\bnew year'?s eve\b|\bnye\b/.test(t)) return pick((yr) => ({ start: iso(yr, 12, 31), end: iso(yr + 1, 1, 1) }), "New Year's Eve");
  if (/\bnew year'?s day\b/.test(t)) return pick((yr) => ({ start: iso(yr, 1, 1), end: iso(yr, 1, 1) }), "New Year's Day");
  if (/\bnew year\b/.test(t)) return pick((yr) => ({ start: iso(yr, 12, 31), end: iso(yr + 1, 1, 1) }), "New Year");
  if (/\beaster\b/.test(t)) return pick((yr) => ({ start: addDays(easter(yr), -2), end: addDays(easter(yr), 1) }), "Easter");
  if (/\bvalentine'?s?\b/.test(t)) return pick((yr) => ({ start: iso(yr, 2, 14), end: iso(yr, 2, 14) }), "Valentine's Day");
  if (/\bhalloween\b/.test(t)) return pick((yr) => ({ start: iso(yr, 10, 31), end: iso(yr, 10, 31) }), "Halloween");
  if (/\bthanksgiving\b/.test(t)) return pick((yr) => ({ start: nthWeekday(yr, 11, 4, 4), end: addDays(nthWeekday(yr, 11, 4, 4), 3) }), "Thanksgiving");
  return null;
}

/** A numeric date "14/11", "14/11/2026", "14.11.26", "11/14" (US, when the day can't be first). */
function numeric(a: number, b: number, y: number | null, today: string, dayFirst: boolean): { day: string | null; note: string | null } {
  let d = a, m = b, note: string | null = null;
  if (a > 12 && b <= 12) [d, m] = [a, b];
  else if (b > 12 && a <= 12) [d, m] = [b, a];
  else if (a <= 12 && b <= 12 && a !== b) {
    [d, m] = dayFirst ? [a, b] : [b, a];
    note = `Read ${a}/${b} as ${d} ${MONTHS[m - 1].replace(/^./, (c) => c.toUpperCase())} (day first). Say the month name if you meant otherwise`;
  }
  return { day: dated(m, d, y, today), note };
}

/** All the explicit dates written in the text, in order of appearance. */
function explicitDates(t: string, today: string, dayFirst: boolean): { at: number; day: string; note: string | null }[] {
  const out: { at: number; day: string; note: string | null }[] = [];
  const push = (at: number, day: string | null, note: string | null = null) => {
    if (day && !out.some((o) => Math.abs(o.at - at) < 3)) out.push({ at, day, note });
  };
  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) push(m.index!, valid(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null);
  for (const m of t.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g)) {
    const r = numeric(+m[1], +m[2], m[3] ? +m[3] : null, today, dayFirst);
    push(m.index!, r.day, r.note);
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})${ORD}(?:\\s+of)?\\s+${MONTH}\\b,?(?:\\s+(\\d{4}))?`, "g"))) push(m.index!, dated(monthOf(m[2]), +m[1], m[3] ? +m[3] : null, today));
  for (const m of t.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})${ORD}\\b(?!\\s*(?:days?|nights?|weeks?|people|guests|hours?))(?:,?\\s+(\\d{4}))?`, "g"))) push(m.index!, dated(monthOf(m[1]), +m[2], m[3] ? +m[3] : null, today));
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Reads when the trip is from the request: start, end and notes. Ranges and explicit dates win; then
 * holidays, relative days ("tomorrow", "next Friday", "in 3 days"), weekends, "next week/month",
 * "early/mid/late <month>" and a bare month. Lengths ("5 nights") are read separately (statedNights).
 */
export function readWhen(text: string, today: string, opts: { dayFirst?: boolean } = {}): When {
  const t = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ")} `;
  const dayFirst = opts.dayFirst ?? true;
  const notes: string[] = [];
  const done = (start: string | null, end: string | null): When => {
    // "Friday 14 Nov" when the 14th is a Saturday: the date wins, and we say so.
    const said = t.match(new RegExp(`\\b${WEEKDAY}\\b,?\\s+(?:the\\s+)?\\d{1,2}${ORD}\\b|\\b${WEEKDAY}\\b,?\\s+${MONTH}\\s+\\d{1,2}`));
    if (start && said) {
      const wd = dayOfWeek(said[1] ?? said[2]);
      const cap = (w: string) => w.replace(/^./, (c) => c.toUpperCase());
      if (wd >= 0 && wd !== weekday(start)) notes.push(`${nice(start).replace(/^\w+, /, "")} is a ${cap(WEEKDAYS[weekday(start)])}, not a ${cap(WEEKDAYS[wd])}, so I went by the date`);
    }
    if (start && end && end < start) end = null;
    return { start, end, notes };
  };

  // 1. Ranges written with a month: "14-16 Nov", "Nov 14-16", "14 Nov to 2 Dec", "Nov 14 to Dec 2".
  let m = t.match(new RegExp(`\\b(\\d{1,2})${ORD}${TO}(\\d{1,2})${ORD}(?:\\s+of)?\\s+${MONTH}\\b,?(?:\\s+(\\d{4}))?`));
  if (m) {
    const s = dated(monthOf(m[3]), +m[1], m[4] ? +m[4] : null, today);
    const e = s ? dated(monthOf(m[3]), +m[2], +s.slice(0, 4), today) : null;
    if (s && e) return done(s, e < s ? dated(monthOf(m[3]) % 12 + 1, +m[2], +s.slice(0, 4) + (monthOf(m[3]) === 12 ? 1 : 0), today) : e);
  }
  m = t.match(new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})${ORD}${TO}(?:${MONTH}\\.?\\s+)?(\\d{1,2})${ORD}\\b(?!\\s*(?:days?|nights?|people|guests))(?:,?\\s+(\\d{4}))?`));
  if (m) {
    const s = dated(monthOf(m[1]), +m[2], m[5] ? +m[5] : null, today);
    const em = m[3] ? monthOf(m[3]) : monthOf(m[1]);
    const ey = s ? +s.slice(0, 4) + (em < monthOf(m[1]) ? 1 : 0) : null;
    const e = s && ey ? dated(em, +m[4], ey, today) : null;
    if (s && e) return done(s, e);
  }
  m = t.match(new RegExp(`\\b(\\d{1,2})${ORD}(?:\\s+of)?\\s+${MONTH}${TO}(\\d{1,2})${ORD}(?:\\s+of)?\\s+${MONTH}\\b(?:,?\\s+(\\d{4}))?`));
  if (m) {
    const s = dated(monthOf(m[2]), +m[1], m[5] && monthOf(m[4]) >= monthOf(m[2]) ? +m[5] : null, today);
    const ey = s ? +s.slice(0, 4) + (monthOf(m[4]) < monthOf(m[2]) ? 1 : 0) : null;
    const e = s && ey ? dated(monthOf(m[4]), +m[3], ey, today) : null;
    if (s && e) return done(s, e);
  }
  // 2. Two explicit dates anywhere ("from 2026-11-14 to 2026-11-20", "14/11 - 20/11").
  const dates = explicitDates(t, today, dayFirst);
  for (const d of dates) if (d.note) notes.push(d.note);
  if (dates.length >= 2 && dates[1].day > dates[0].day) return done(dates[0].day, dates[1].day);
  // 3. Day-of-month range without a month: "the 14th to the 16th" (this month, or next if it's passed).
  m = t.match(new RegExp(`\\b(?:from\\s+|between\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)${TO}(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\b`));
  if (m && !dates.length) {
    const y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
    let s = valid(y, mo, +m[1]) && iso(y, mo, +m[1]) >= today ? iso(y, mo, +m[1]) : null;
    if (!s) s = valid(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, +m[1]) ? iso(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, +m[1]) : null;
    if (s) {
      const sy = +s.slice(0, 4), sm = +s.slice(5, 7);
      const e = +m[2] >= +m[1] ? (valid(sy, sm, +m[2]) ? iso(sy, sm, +m[2]) : null) : dated(sm % 12 + 1, +m[2], sm === 12 ? sy + 1 : sy, today);
      if (e) return done(s, e);
    }
  }
  // 4. Weekday ranges: "Friday to Sunday", "from Thu till next Monday".
  m = t.match(new RegExp(`\\b(?:from\\s+)?(this|next|coming)?\\s*${WEEKDAY}${TO}(?:next\\s+)?${WEEKDAY}\\b`));
  if (m && !dates.length) {
    const a = dayOfWeek(m[2]), b = dayOfWeek(m[3]);
    if (a >= 0 && b >= 0) {
      const s = nextWeekday(a, today, m[1] === "next");
      return done(s, addDays(s, ((b - a + 7) % 7) || 7));
    }
  }
  // 5. One explicit date: the start.
  if (dates.length) return done(dates[0].day, null);
  // 6. Holidays.
  const h = holiday(t, today);
  if (h) return done(h.start, h.end);
  // 7. Relative days.
  if (/\bday after tomorrow\b/.test(t)) return done(addDays(today, 2), null);
  if (/\b(tonight|today|this evening|this afternoon|this morning|right now)\b/.test(t)) return done(today, null);
  if (/\btomorrow\b/.test(t)) return done(addDays(today, 1), null);
  m = t.match(/\bin (\d{1,3}|a|one|two|three|four|five|six|seven|eight|nine|ten) (day|week|month)s?(?:'? time)?\b/) ?? t.match(/\b(\d{1,3}|a|one|two|three|four|five|six|seven|eight|nine|ten) (day|week|month)s? from (?:now|today)\b/);
  if (m) {
    const n = /^\d/.test(m[1]) ? +m[1] : ({ a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as Record<string, number>)[m[1]];
    if (m[2] === "month") {
      const x = new Date(`${today}T12:00:00Z`);
      x.setUTCMonth(x.getUTCMonth() + n);
      return done(x.toISOString().slice(0, 10), null);
    }
    return done(addDays(today, n * (m[2] === "week" ? 7 : 1)), null);
  }
  // 8. Weekends.
  if (/\b(this|next|coming)?\s*(long )?weekend\b/.test(t)) {
    const next = /\bnext weekend\b/.test(t);
    const long = /\blong weekend\b/.test(t);
    const wd = weekday(today);
    if (!next && wd === 6) return done(today, addDays(today, long ? 2 : 1));
    if (!next && wd === 0) return done(addDays(today, 5), addDays(today, long ? 8 : 7));
    const fri = nextWeekday(5, today, next && wd >= 5);
    const start = next && wd < 5 ? addDays(fri, 7) : fri;
    return done(start, addDays(start, long ? 3 : 2));
  }
  // 9. A weekday: "on Friday", "next Monday".
  m = t.match(new RegExp(`\\b(this|on|next|coming)?\\s*${WEEKDAY}\\b(?!\\s*(?:night|nights)\\b)`));
  if (m) {
    const wd = dayOfWeek(m[2]);
    if (wd >= 0 && m[2].length >= 3 && !/^(sat|sun|mon|wed)$/.test(m[2])) return done(nextWeekday(wd, today, m[1] === "next"), null);
    if (wd >= 0 && /day$/.test(m[2])) return done(nextWeekday(wd, today, m[1] === "next"), null);
  }
  // 10. Next week / next month / end of the month.
  if (/\bnext week\b/.test(t)) return done(nextWeekday(1, today, true), null);
  if (/\b(end of (?:the |this )?month|month'?s end)\b/.test(t)) {
    const y = +today.slice(0, 4), mo = +today.slice(5, 7);
    const last = iso(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate());
    const fri = nthWeekday(y, mo, 5, -1);
    return done(fri >= today ? fri : last >= today ? last : today, null);
  }
  if (/\bnext month\b/.test(t)) {
    const y = +today.slice(0, 4), mo = +today.slice(5, 7);
    return done(mo === 12 ? iso(y + 1, 1, 1) : iso(y, mo + 1, 1), null);
  }
  // 11. "early/mid/late December", or a bare month ("in December", "a December trip").
  // Full month names only ("Mar del Plata" isn't March); "May" only where it can't be the verb.
  m = t.match(new RegExp(`\\b(early|mid|middle of|late|end of|beginning of|start of)?[\\s-]*${FULL_MONTH}\\b(?!\\s*\\d{1,2}${ORD}\\b(?!\\s*(?:days?|nights?|weeks?|people|guests)))(?:\\s+(\\d{4}))?`));
  if (m && (m[2] !== "may" || m[1] || m[3] || /\b(?:in|of|during|this|next|for|until|till) (?:early |mid |late )?may\b/.test(t))) {
    const mo = monthOf(m[2]);
    const part = m[1] ?? "";
    const day = /early|beginning|start/.test(part) ? 5 : /mid|middle/.test(part) ? 15 : /late|end/.test(part) ? 24 : 1;
    let s = dated(mo, day, m[3] ? +m[3] : null, today);
    // This very month with no part named: from today.
    if (!part && !m[3] && +today.slice(5, 7) === mo) s = today;
    if (s) {
      notes.push(`You named ${m[2].replace(/^./, (c) => c.toUpperCase())} but not the days, so it starts ${nice(s)}. Tell me your dates to change it`);
      return done(s, null);
    }
  }
  return { start: null, end: null, notes };
}

/** "at 8pm", "8:30 pm", "20:00", "half past 7 tonight", "quarter to 9", "noon", "midnight", "lunchtime". Pure. */
export function readTime(text: string): string | null {
  const t = text.toLowerCase();
  const pad = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const evening = /\b(dinner|supper|drinks|tonight|evening|night|pm)\b/.test(t);
  const ampm = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3].startsWith("p")) h += 12;
    const m = Number(ampm[2] ?? 0);
    return h < 24 && m < 60 ? pad(h, m) : null;
  }
  const h24 = t.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/);
  if (h24) return pad(Number(h24[1]), Number(h24[2]));
  const words = t.match(/\b(half past|quarter past|quarter to) (\d{1,2})\b/);
  if (words) {
    let h = Number(words[2]);
    if (h >= 1 && h <= 11 && evening) h += 12;
    const [hh, mm] = words[1] === "half past" ? [h, 30] : words[1] === "quarter past" ? [h, 15] : [h - 1, 45];
    return hh >= 0 && hh < 24 ? pad(hh, mm) : null;
  }
  if (/\bmidnight\b/.test(t)) return "00:00";
  if (/\b(noon|midday)\b/.test(t)) return "12:00";
  if (/\blunch ?time\b/.test(t)) return "13:00";
  const bare = t.match(/\bat (\d{1,2})(?: o'?clock)?\b(?!\s*(?:people|guests|of|th|st|nd|rd|%|days?|nights?))/);
  if (bare) {
    const h = Number(bare[1]);
    if (h >= 1 && h <= 11 && evening) return pad(h + 12, 0);
    if (h >= 12 && h <= 23) return pad(h, 0);
    if (h >= 7 && h <= 11 && /\b(breakfast|brunch|morning)\b/.test(t)) return pad(h, 0);
  }
  return null;
}
