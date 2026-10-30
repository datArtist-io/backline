// Binds an approval to the exact plan the person saw. When a run stops at a checkpoint, the server
// seals its plan and step results (gzip + HMAC-SHA256 with a server-only key) and hands the seal to
// the browser. "Do it" sends the seal back, so any server instance can resume the very same plan,
// and nothing the browser changes is accepted: a tampered or foreign seal is rejected.
import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Plan, SkillResult } from "@backline/engine";

/** final: a finished run, sealed only so follow-up questions work on any instance; never accepted as an approval. */
export type Sealed = { runId: string; plan: Plan; results: Record<string, SkillResult<unknown>>; at: number; final?: boolean };

const TTL_MS = 2 * 60 * 60_000;

function key(): string | null {
  const k = process.env.RUN_SEAL_KEY || process.env.SUPABASE_SECRET_KEY || process.env.TRAVEL_DOCS_KEY || "";
  return k.length >= 16 ? `backline-run-seal:${k}` : null;
}

const mac = (k: string, body: string) => createHmac("sha256", k).update(body).digest("base64url");

/** "<body>.<mac>", or null when the server has no key to seal with. */
export function sealRun(s: Sealed): string | null {
  const k = key();
  if (!k) return null;
  const body = gzipSync(Buffer.from(JSON.stringify(s))).toString("base64url");
  return `${body}.${mac(k, body)}`;
}

/** The sealed run, or null when the seal is missing, forged, for another run, or expired. */
export function openRun(seal: string | undefined, runId: string | undefined, now = Date.now()): Sealed | null {
  const k = key();
  if (!k || !seal || !runId) return null;
  const dot = seal.lastIndexOf(".");
  if (dot < 1) return null;
  const body = seal.slice(0, dot);
  const given = Buffer.from(seal.slice(dot + 1));
  const want = Buffer.from(mac(k, body));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const s = JSON.parse(gunzipSync(Buffer.from(body, "base64url")).toString("utf8")) as Sealed;
    if (s.runId !== runId || now - s.at > TTL_MS) return null;
    return s;
  } catch {
    return null;
  }
}
