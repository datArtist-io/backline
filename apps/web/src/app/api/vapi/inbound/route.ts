// Vapi's server URL for the "Call Backline" number. Two messages matter:
// - assistant-request: someone is calling, so answer with Backline's travel agent.
// - tool-calls (plan_trip): the caller said where and what they love, so hand back the trip's code
//   and, if they asked, email them the link. The call is checked with Vapi first, so this endpoint
//   can't be used to send emails from outside a real call.
import { createContext } from "@backline/engine";
import { goalOf, inboundAssistant, isBacklineCall, SITE, tripArgs, tripCode, tripUrl, vapi, vapiReady, type CallTrip } from "@/lib/vapi";
import { remember } from "@/lib/call-trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const emailed = new Set<string>();
const sentToday = { day: "", n: 0 };

type ToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };

async function realInboundCall(id: string | undefined): Promise<boolean> {
  if (!id || !vapiReady()) return false;
  const call = await vapi<Record<string, unknown>>(`/call/${encodeURIComponent(id)}`).catch(() => null);
  return Boolean(call && call.status !== "ended" && isBacklineCall(call));
}

async function emailLink(callId: string, trip: CallTrip, code: string, real: boolean): Promise<"sent" | "failed" | "skipped"> {
  if (!trip.email || emailed.has(callId)) return "skipped";
  if (!real) return "failed";
  const day = new Date().toISOString().slice(0, 10);
  if (sentToday.day !== day) Object.assign(sentToday, { day, n: 0 });
  if (sentToday.n >= 100) return "failed";
  const ctx = createContext(process.env);
  if (!ctx.email) return "failed";
  try {
    emailed.add(callId);
    sentToday.n += 1;
    await ctx.email.send({
      to: trip.email,
      subject: `Your Backline trip: ${trip.destination}`,
      text: [
        `Here's the trip you planned on the phone with Backline.`,
        ``,
        `"${goalOf(trip)}"`,
        ``,
        `Open it here: ${tripUrl(trip)}`,
        ``,
        `Trip code: ${code}. You can also find it on ${SITE} under "Call Backline".`,
        ``,
        `Backline reads your taste with Qloo, plans the whole trip on a 3D map, and books and pays for it in one tap.`,
        ``,
        `You got this email because you asked for it on a call to Backline. We won't email you again.`,
      ].join("\n"),
    });
    return "sent";
  } catch (err) {
    console.error("[inbound] email failed", err instanceof Error ? err.message : err);
    return "failed";
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { message?: Record<string, unknown> } | null;
  const m = body?.message;
  const type = m?.type;

  if (type === "assistant-request") return Response.json({ assistant: inboundAssistant() });

  if (type === "tool-calls") {
    const call = (m?.call ?? {}) as { id?: string };
    const list = ((m?.toolCallList ?? (m?.toolWithToolCallList as { toolCall?: ToolCall }[] | undefined)?.map((x) => x.toolCall)) ?? []) as ToolCall[];
    // Only a real call to the Backline number can list a trip or send an email.
    const real = await realInboundCall(call.id);
    const results = await Promise.all(
      list.map(async (tc) => {
        if (tc?.function?.name !== "plan_trip") return { toolCallId: tc?.id ?? "", result: "Unknown tool." };
        const trip = tripArgs(tc.function.arguments);
        if (!trip || !call.id) return { toolCallId: tc.id ?? "", result: "I need at least the destination to plan the trip." };
        const code = tripCode(call.id);
        if (real) remember(call.id, trip);
        const mail = await emailLink(call.id, trip, code, real);
        const digits = code.split("").join(" ");
        return {
          toolCallId: tc.id ?? "",
          result: [
            `Trip started: ${goalOf(trip)}.`,
            `Trip code: ${digits}. It's on the Backline website in the "Call Backline" section, being built now.`,
            mail === "sent" ? `The link was emailed to ${trip.email}.` : mail === "failed" ? "The email couldn't be sent, so point them to the website and the code instead." : "",
          ]
            .filter(Boolean)
            .join(" "),
        };
      })
    );
    return Response.json({ results });
  }

  // Status updates, transcripts and end-of-call reports need no answer.
  return Response.json({ ok: true });
}
