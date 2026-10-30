// Search history: the latest requests (GET), and forgetting one or all of them (DELETE ?id=… or ?all=1).
import { getSession } from "@/lib/session";
import { deleteSearches, loadSearches } from "@/lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ searches: [], signedIn: false });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 30) || 30;
  try {
    return Response.json({ searches: await loadSearches(s, limit) });
  } catch (err) {
    console.error("[account] searches load failed", err instanceof Error ? err.message : err);
    return Response.json({ searches: [] });
  }
}

export async function DELETE(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Sign in first." }, { status: 401 });
  const q = new URL(req.url).searchParams;
  // Say so when it didn't work, so nothing looks deleted that isn't (a passport above all).
  try {
    await deleteSearches(s, q.get("all") === "1" ? "all" : (q.get("id") ?? ""));
  } catch (err) {
    console.error("[account] search delete failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Your search history couldn't be cleared. Try again." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
