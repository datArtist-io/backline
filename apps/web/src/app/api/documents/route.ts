// Reads one attached file into text for the agent. Word, PowerPoint, Excel, text and web pages
// are read here; PDFs and photos go to Claude when it's connected (scans, flyers, tickets).
// Nothing is stored: the text goes back to the user's browser and travels with their mission.
import { ClaudeReader, EngineError, MAX_DOC_BYTES, readDocument } from "@backline/engine";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const rateLimited = rateLimiter(20);

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (rateLimited(ip)) return fail(429, "That's a lot of files at once. Wait a minute and try again.");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_DOC_BYTES + 64 * 1024) return fail(413, "That file is over 4 MB. Try a smaller version, or a photo of the page that matters.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Attach a file and try again.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail(400, "Attach a file and try again.");
  if (file.size > MAX_DOC_BYTES) return fail(413, "That file is over 4 MB. Try a smaller version, or a photo of the page that matters.");

  const key = process.env.ANTHROPIC_API_KEY?.trim();
  const reader = key ? new ClaudeReader({ apiKey: key, model: process.env.CLAUDE_SEARCH_MODEL || undefined }) : null;
  try {
    const document = await readDocument({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, { reader, signal: req.signal });
    return Response.json({ document, chars: document.text.length });
  } catch (err) {
    if (err instanceof EngineError) return fail(422, err.userMessage);
    console.error("[documents] read failed", err instanceof Error ? err.message : err);
    return fail(500, "Couldn't read that file. Try again, or paste the text.");
  }
}
