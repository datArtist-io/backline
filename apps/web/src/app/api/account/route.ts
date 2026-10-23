// The signed-in person's account: details, memories and trips (GET), and saving details (PUT).
import { cleanProfile } from "@backline/engine";
import { getSession } from "@/lib/session";
import { loadAccount, saveAccountProfile } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in to see your account." }, { status: 401 });
  try {
    return Response.json({ user: s.user, ...(await loadAccount(s)) });
  } catch (err) {
    console.error("[account] load failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Your account couldn't load. Try again." }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in to save your details." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { profile?: unknown };
  const profile = cleanProfile(body.profile ?? {});
  try {
    await saveAccountProfile(s, profile);
    return Response.json({ profile });
  } catch (err) {
    console.error("[account] save failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Your details couldn't be saved. Try again." }, { status: 502 });
  }
}
