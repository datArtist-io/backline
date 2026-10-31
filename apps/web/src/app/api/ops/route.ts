// The private monitoring feed for /ops. Only for accounts in ADMIN_EMAILS; anyone else gets a 404,
// so the page and the feed don't even admit they exist. ?check=1 also tests every outside service.
import { checkServices } from "@backline/engine";
import { configSummary, opsSession, ops, usageCounts } from "@/lib/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!(await opsSession())) return new Response("Not found", { status: 404 });
  const check = new URL(req.url).searchParams.get("check") === "1";
  const [services, usage] = await Promise.all([check ? checkServices(process.env).catch(() => null) : Promise.resolve(null), usageCounts()]);
  const mem = process.memoryUsage();
  return Response.json(
    {
      at: new Date().toISOString(),
      deploy: {
        env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0]?.slice(0, 120) ?? null,
        region: process.env.VERCEL_REGION ?? null,
        url: process.env.VERCEL_URL ?? null,
      },
      instance: { since: new Date(ops.started).toISOString(), memoryMb: Math.round(mem.rss / 1048576), missions: ops.counts.missions, withProblems: ops.counts.failed },
      services,
      config: configSummary(),
      usage,
      runs: ops.runs,
      logs: ops.logs,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
