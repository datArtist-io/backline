// The Backline phone number and the trips people planned by calling it (code and trip only).
import { backlineNumber, board, tripForCall } from "@/lib/call-trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const call = new URL(req.url).searchParams.get("call");
  if (call) {
    if (!/^[0-9a-f-]{20,64}$/i.test(call)) return Response.json({ trip: null });
    return Response.json({ trip: await tripForCall(call).catch(() => null) }, { headers: { "Cache-Control": "no-store" } });
  }
  const [number, trips] = await Promise.all([backlineNumber().catch(() => null), board().catch(() => [])]);
  return Response.json({ number, trips }, { headers: { "Cache-Control": "no-store" } });
}
