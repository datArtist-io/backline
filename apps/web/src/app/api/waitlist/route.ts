// Waitlist signup. Validates input, blocks obvious bots, stores the signup and returns the queue position.
import { z } from "zod";
import { BRAND } from "@/lib/brand";
import { ROLES, WaitlistUnavailable, joinWaitlist, sendConfirmation } from "@/lib/waitlist";
import { verifiedIdentity } from "@/lib/auth-server";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize("NFC").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max))
    .optional();

const bodySchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "That email is too long.")
    .email("Enter a valid email address.")
    .optional(),
  /** From Google or Apple sign-in. Verified with Supabase; the email comes from the token, never the client. */
  accessToken: z.string().max(4096).optional(),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Tell us what you do." }) }),
  name: clean(80),
  artist: clean(120),
  country: clean(80),
  ref: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9]{8}$/)
    .optional()
    .catch(undefined),
  consent: z.literal(true, { errorMap: () => ({ message: "Please agree to the privacy notice to join." }) }),
  marketing: z.boolean().default(false),
  // Bot traps: a field humans never see, and the time the form was opened.
  website: z.string().optional(),
  openedAt: z.number().optional(),
});

// Best-effort per-IP limit; replaced by Upstash in Milestone 6.
const rateLimited = rateLimiter(5, 10 * 60_000);

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return fail(429, "Too many attempts. Try again in a few minutes.");

  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Check the form and try again.");
    body = parsed.data;
  } catch {
    return fail(400, "Check the form and try again.");
  }

  // Bots fill hidden fields and submit instantly. Give them a plausible answer and store nothing.
  const tooFast = !body.accessToken && body.openedAt !== undefined && Date.now() - body.openedAt < 1500;
  if (body.website || tooFast) return Response.json({ already: true, total: 0 });

  let email = body.email;
  let name = body.name;
  let source = "web";
  if (body.accessToken) {
    const who = await verifiedIdentity(body.accessToken);
    if (!who) return fail(401, "Your sign-in expired. Please try again.");
    email = who.email;
    name = name || who.name || undefined;
    source = who.provider === "apple" ? "apple" : who.provider === "google" ? "google" : "oauth";
  }
  if (!email) return fail(400, "Enter your email to join.");

  try {
    const result = await joinWaitlist({
      email,
      role: body.role,
      name: name || undefined,
      artist: body.artist || undefined,
      country: body.country || undefined,
      ref: body.ref?.toLowerCase(),
      marketing: body.marketing,
      source,
    });
    if (result.already) return Response.json(result);

    const referralUrl = `${new URL(req.url).origin}/join?ref=${result.refCode}`;
    let emailed = false;
    try {
      emailed = await sendConfirmation(email, { position: result.position, referralUrl, productName: BRAND.name });
    } catch (err) {
      console.error("[waitlist] confirmation email failed", err instanceof Error ? err.message : err);
    }
    return Response.json({ ...result, referralUrl, emailed });
  } catch (err) {
    if (err instanceof WaitlistUnavailable) return fail(503, "The waitlist opens soon. Check back shortly.");
    console.error("[waitlist] join failed", err instanceof Error ? err.message : err);
    return fail(502, "We couldn't add you just now. Try again in a moment.");
  }
}
