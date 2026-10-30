// Forget one thing the agent remembered.
import { getSession } from "@/lib/session";
import { forgetMemory } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  // Say so when it didn't work, so nothing looks deleted that isn't (a passport above all).
  try {
    await forgetMemory(s, id);
  } catch (err) {
    console.error("[account] forget failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "That preference couldn't be removed. Try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
