// Turns what another assistant knows about you (pasted in) into your preferences.
// Nothing is stored on the server: the result goes back to the browser.
import { z } from "zod";
import { createContext, extractProfile } from "@backline/engine";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ text: z.string().trim().min(10, "Paste a little more.").max(8000, "That's too long. Paste the summary only.") });

const rateLimited = rateLimiter(6);

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return Response.json({ error: "Too many imports. Wait a minute." }, { status: 429 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check what you pasted." }, { status: 400 });
  try {
    const ctx = createContext(process.env, { signal: req.signal });
    const profile = await extractProfile(ctx.llm, parsed.data.text, req.signal);
    return Response.json({ profile });
  } catch (err) {
    console.error("[profile] import failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Couldn't read that just now. Try again." }, { status: 502 });
  }
}
