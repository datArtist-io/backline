// Whether outside services answer right now (AI models, research, Qloo). Anyone gets up or down
// ({ ok, core, at }). The per-service list, with timings and the HTTP status when one fails, needs
// `Authorization: Bearer $HEALTH_TOKEN` (the synthetic monitor) or an account in ADMIN_EMAILS.
// Never returns keys or content.
import { checkServices } from "@backline/engine";
import { bearerMatches, publicHealth } from "@/lib/health-view";
import { opsSession } from "@/lib/ops";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rateLimited = rateLimiter(6);
const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many checks. Wait a minute." }, { status: 429 });
  const at = new Date().toISOString();
  try {
    const services = await checkServices(process.env);
    const summary = publicHealth(services, at);
    const detailed = bearerMatches(req.headers.get("authorization"), process.env.HEALTH_TOKEN) || (await opsSession()) !== null;
    if (!detailed) return Response.json(summary, { headers: noStore });
    const failing = services.filter((s) => s.ok === false).map((s) => s.service);
    return Response.json({ ...summary, failing, services }, { headers: noStore });
  } catch {
    return Response.json({ ok: false, core: false, at, error: "check failed" }, { status: 500, headers: noStore });
  }
}
