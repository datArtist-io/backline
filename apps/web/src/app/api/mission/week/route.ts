// One more week of a long trip. The first pass writes as many weeks as time allows and leaves the rest
// as drafts from the places it found; the browser then asks for each remaining week here, so a trip of
// any length (a month, a year) ends up planned day by day by the model. Answers only from the run's results.
import { z } from "zod";
import { createContext, writePlanWeek, type BriefInput, type Place, type TripAgentOutput } from "@backline/engine";
import { getRun, isRunId } from "@/lib/run-store";
import { openRun } from "@/lib/run-seal";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  runId: z.string(),
  seal: z.string().max(3_000_000).optional(),
  from: z.number().int().min(0).max(1100),
  /** Places already used on earlier days, so the new week varies them. */
  usedIds: z.array(z.string().max(120)).max(200).optional(),
});

const rateLimited = rateLimiter(40);
const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return fail(429, "Writing too fast. Wait a moment.");
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "That request isn't complete.");
  const body = parsed.data;
  const run = isRunId(body.runId) ? (getRun(body.runId) ?? openRun(body.seal, body.runId)) : null;
  if (!run) return fail(410, "This trip has expired. Plan it again to write the rest.");
  const agent = run.results["trip.agent"]?.data as TripAgentOutput | undefined;
  if (run.plan.mission !== "plan" || !agent) return fail(400, "There's no trip to write.");
  let ctx: ReturnType<typeof createContext>;
  try {
    ctx = createContext(process.env, { signal: req.signal });
  } catch {
    return fail(503, "The agent isn't configured yet.");
  }
  if (!ctx.llm) return fail(503, "No AI model is answering right now.");
  const byId = new Map<string, Place>([...agent.stays, ...agent.dines, ...agent.venues, ...agent.activities].map((p) => [p.id, p]));
  const used = (body.usedIds ?? []).map((id) => byId.get(id)?.name).filter((n): n is string => Boolean(n));
  const input: BriefInput = { artist: "", trip: run.plan.trip ?? undefined, request: run.plan.asked ?? run.plan.goal, language: run.plan.language };
  try {
    const days = await writePlanWeek(ctx, input, run.results, body.from, used);
    return Response.json({ from: body.from, days });
  } catch (err) {
    console.error("[mission/week] failed", err instanceof Error ? err.message : err);
    return fail(502, "That week couldn't be written just now.");
  }
}
