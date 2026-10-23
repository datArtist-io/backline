// Encryption for travel documents. AES-256-GCM with a key that lives only in the server's
// environment (TRAVEL_DOCS_KEY, 32 random bytes in base64), so the database never holds a readable
// passport and a database leak alone reveals nothing. Server-only.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function key(): Buffer | null {
  const raw = process.env.TRAVEL_DOCS_KEY?.trim();
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}

export const vaultReady = () => key() !== null;

/** Encrypt a value; the user id is bound in as associated data, so a row can't be moved to another person. */
export function seal(value: unknown, userId: string): string {
  const k = key();
  if (!k) throw new Error("TRAVEL_DOCS_KEY is missing or not 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function open<T>(sealed: string, userId: string): T {
  const k = key();
  if (!k) throw new Error("TRAVEL_DOCS_KEY is missing or not 32 bytes");
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unreadable document");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")) as T;
}
