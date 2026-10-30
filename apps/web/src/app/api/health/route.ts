// Which outside services answer right now (AI models, research, Qloo), with timings and the HTTP
// status when one fails. For diagnosing a live deployment. Never returns keys or content.
import { checkServices } from "@backline/engine";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rateLimited = rateLimiter(6);

export async function GET(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many checks. Wait a minute." }, { status: 429 });
  try {
    const services = await checkServices(process.env);
    const failing = services.filter((s) => s.ok === false).map((s) => s.service);
    return Response.json({ ok: failing.length === 0, failing, services, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "check failed" }, { status: 500 });
  }
}
