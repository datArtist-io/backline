// A signed-in person's passport: validated, encrypted before storage, shown only as a masked
// summary, and decrypted on the server only to book a flight. Server-only.
import { z } from "zod";
import type { PassportDetails } from "@backline/engine";
import { rest } from "./supabase";
import type { Session } from "./session";
import { open, seal } from "./vault";

const today = () => new Date().toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use the two-letter country code, e.g. NG");

export const passportSchema = z.object({
  givenNames: z.string().trim().min(1).max(60).regex(/^[\p{L}' -]+$/u, "Letters only, as on your passport"),
  familyName: z.string().trim().min(1).max(60).regex(/^[\p{L}' -]+$/u, "Letters only, as on your passport"),
  number: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5,20}$/, "Check the passport number"),
  nationality: COUNTRY,
  issuingCountry: COUNTRY,
  expiresOn: z.string().regex(DATE).refine((d) => d > today(), "This passport has expired"),
  birthDate: z.string().regex(DATE).refine((d) => d < today() && d > "1900-01-01", "Check the date of birth"),
  gender: z.enum(["m", "f"]),
});

/** What the account page shows: never the full number. */
export type PassportSummary = { name: string; numberEnding: string; nationality: string; issuingCountry: string; expiresOn: string; updatedAt: string };

const summaryOf = (p: PassportDetails, updatedAt: string): PassportSummary => ({
  name: `${p.givenNames} ${p.familyName}`,
  numberEnding: p.number.slice(-3),
  nationality: p.nationality,
  issuingCountry: p.issuingCountry,
  expiresOn: p.expiresOn,
  updatedAt,
});

type Row = { ciphertext: string; summary: PassportSummary; updated_at: string };

const rowFor = async (s: Session) => (await rest<Row[]>(s.cfg, s.accessToken, `travel_documents?select=ciphertext,summary,updated_at&user_id=eq.${encodeURIComponent(s.user.id)}`))[0] ?? null;

export async function passportSummary(s: Session): Promise<PassportSummary | null> {
  const row = await rowFor(s);
  return row ? row.summary : null;
}

export async function savePassport(s: Session, p: PassportDetails): Promise<PassportSummary> {
  const now = new Date().toISOString();
  const summary = summaryOf(p, now);
  await rest(s.cfg, s.accessToken, "travel_documents?on_conflict=user_id", {
    method: "POST",
    body: { user_id: s.user.id, ciphertext: seal(p, s.user.id), summary, consent_at: now, updated_at: now },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  return summary;
}

export async function deletePassport(s: Session): Promise<void> {
  await rest(s.cfg, s.accessToken, `travel_documents?user_id=eq.${encodeURIComponent(s.user.id)}`, { method: "DELETE", prefer: "return=minimal" });
}

/** The full passport for booking, or null. Expired passports aren't used. */
export async function passportForBooking(s: Session): Promise<PassportDetails | null> {
  const row = await rowFor(s);
  if (!row) return null;
  const p = open<PassportDetails>(row.ciphertext, s.user.id);
  return p.expiresOn > today() ? p : null;
}
