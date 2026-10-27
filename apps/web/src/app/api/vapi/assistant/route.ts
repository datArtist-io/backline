// The agent a browser call talks to: the same Backline travel agent as the phone line, told it's on
// the website so it opens the trip on screen instead of reading out a code.
import { inboundAssistant } from "@/lib/vapi";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ assistant: inboundAssistant("web"), ready: Boolean(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY) }, { headers: { "Cache-Control": "no-store" } });
}
