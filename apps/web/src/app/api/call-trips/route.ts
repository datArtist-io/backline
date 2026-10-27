// The Backline phone number and the trips people planned by calling it (code and trip only).
import { backlineNumber, board } from "@/lib/call-trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [number, trips] = await Promise.all([backlineNumber().catch(() => null), board().catch(() => [])]);
  return Response.json({ number, trips }, { headers: { "Cache-Control": "no-store" } });
}
