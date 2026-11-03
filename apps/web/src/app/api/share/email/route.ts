// "Email it to me": sends the plan to the signed-in person's own address, and only theirs, so this can't
// be used to send mail to anyone else. Limited per person and per day across the site.
import { z } from "zod";
import { createContext } from "@backline/engine";
import { getSession } from "@/lib/session";
import { EMAIL_MAX } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ subject: z.string().trim().min(1).max(160), text: z.string().trim().min(1).max(EMAIL_MAX + 500) });

/** Per person per day, and for the whole site per day (per server instance). */
const PER_PERSON = 5;
const PER_DAY = 200;
const sent = new Map<string, number>();
let today = "";
let total = 0;

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

export async function POST(req: Request) {
  const session = await getSession();
  const to = session?.user.email;
  if (!session || !to) return json(401, { ok: false, reason: "Sign in to have the plan emailed to you." });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(400, { ok: false, reason: "That plan couldn't be read." });

  const day = new Date().toISOString().slice(0, 10);
  if (day !== today) {
    today = day;
    total = 0;
    sent.clear();
  }
  const mine = sent.get(session.user.id) ?? 0;
  if (mine >= PER_PERSON || total >= PER_DAY) return json(429, { ok: false, reason: "You've emailed plans a few times today. Try again tomorrow." });

  const ctx = createContext(process.env);
  if (!ctx.email) return json(503, { ok: false, reason: "Email isn't set up on this site yet." });
  try {
    sent.set(session.user.id, mine + 1);
    total += 1;
    await ctx.email.send({
      to,
      subject: parsed.data.subject,
      text: `${parsed.data.text.slice(0, EMAIL_MAX)}\n\n—\nYou asked Backline to email you this plan. We only send it to the address you signed in with.`,
    });
    return json(200, { ok: true, to });
  } catch (err) {
    console.error("[share] email failed", err instanceof Error ? err.message : err);
    return json(502, { ok: false, reason: "The email couldn't be sent. Try again in a moment." });
  }
}
