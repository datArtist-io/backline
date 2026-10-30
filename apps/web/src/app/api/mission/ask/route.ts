// Follow-up questions on a mission the user just ran. Answers only from that run's results.
import { z } from "zod";
import { answerFollowUp, createContext } from "@backline/engine";
import { getRun, isRunId } from "@/lib/run-store";
import { openRun } from "@/lib/run-seal";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ runId: z.string(), seal: z.string().max(3_000_000).optional(), question: z.string().trim().min(2, "Ask a question.").max(500, "Keep it under 500 characters.") });

const rateLimited = rateLimiter(20);

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return fail(429, "Too many questions at once. Wait a moment.");
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check your question.");
    body = parsed.data;
  } catch {
    return fail(400, "Check your question.");
  }
  // This instance's copy, else the sealed copy the browser kept (any instance can open it).
  const run = isRunId(body.runId) ? (getRun(body.runId) ?? openRun(body.seal, body.runId)) : null;
  if (!run) return fail(410, "This mission has expired. Run it again to ask follow-ups.");

  try {
    const ctx = createContext(process.env, { signal: req.signal });
    const out = await answerFollowUp(ctx.llm, body.question, run.results, { language: run.plan.language, signal: req.signal });
    return Response.json({ ...out, artist: run.plan.artist });
  } catch (err) {
    console.error("[ask] failed", err instanceof Error ? err.message : err);
    return fail(502, "The agent couldn't answer just now. Try again.");
  }
}
