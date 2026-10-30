// Delete a saved trip from the account (bookings themselves stay with the provider).
import { getSession } from "@/lib/session";
import { deleteTrip } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  // Say so when it didn't work, so nothing looks deleted that isn't (a passport above all).
  try {
    await deleteTrip(s, id);
  } catch (err) {
    console.error("[account] trip delete failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "That trip couldn't be deleted. Try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
