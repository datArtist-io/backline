// What /api/health shows to whom. Anyone gets up or down; the per-service list (providers, models,
// hosts, timings) is for the synthetic monitor (HEALTH_TOKEN) and accounts in ADMIN_EMAILS only.
import { createHash, timingSafeEqual } from "node:crypto";
import type { ServiceCheck } from "@backline/engine";

export type PublicHealth = { ok: boolean; core: boolean; at: string };

/**
 * `ok`: every configured service answers. `core`: a person can still plan a trip, meaning Qloo
 * answers and at least one configured model does. Names nothing, so it reveals no stack.
 */
export function publicHealth(services: ServiceCheck[], at: string): PublicHealth {
  const models = services.filter((s) => /^model/.test(s.service) && s.configured);
  const qlooDown = services.some((s) => s.service === "Qloo" && s.ok === false);
  const modelsDown = models.length > 0 && models.every((s) => s.ok === false);
  return { ok: services.every((s) => s.ok !== false), core: !qlooDown && !modelsDown, at };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** `Authorization: Bearer <token>` equals the token, compared in constant time. No token set, no access. */
export function bearerMatches(header: string | null, token: string | undefined): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}
