// Speech-to-text for the voice prompt.
// Receives a short recording, sends it to a Whisper endpoint (auto-detects the language),
// returns the text. Audio is never stored.
import { NextResponse } from "next/server";
import { createContext, tidyTranscript } from "@backline/engine";
import { clientIp, rateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024; // ~60 s of compressed speech is far below this
const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

// Best-effort per-IP limit. Replaced by Upstash Redis limits in Milestone 6.
const rateLimited = rateLimiter(20);

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const key = process.env.STT_API_KEY;
  if (!key) return fail(503, "Voice input isn't set up yet.");

  const ip = clientIp(req);
  if (rateLimited(ip)) return fail(429, "Too many voice requests. Wait a minute and try again.");

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BYTES + 64 * 1024) return fail(413, "That recording is too long. Keep it under a minute.");

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    file = f instanceof File ? f : null;
  } catch {
    return fail(400, "Couldn't read the recording.");
  }
  if (!file || file.size === 0) return fail(400, "No audio was received.");
  if (file.size > MAX_BYTES) return fail(413, "That recording is too long. Keep it under a minute.");

  const type = file.type.split(";")[0].trim().toLowerCase();
  const ext = EXT[type];
  if (!ext) return fail(415, "That audio format isn't supported.");

  const base = (process.env.STT_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const body = new FormData();
  body.append("file", file, `speech.${ext}`);
  body.append("model", process.env.STT_MODEL || "whisper-large-v3-turbo");
  body.append("response_format", "verbose_json");
  body.append("temperature", "0");
  // No "language" field on purpose: Whisper detects it.

  try {
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      // Status only: never log audio or keys.
      console.error("[transcribe] provider returned", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return fail(502, res.status === 401 ? "Voice input's key was rejected. Check STT_API_KEY." : "Couldn't transcribe that. Try again.");
    }
    const data = (await res.json()) as { text?: string; language?: string };
    const raw = (data.text || "").trim();
    // Arrange the voice note into a clean request (same language, nothing added or dropped).
    let text = raw;
    try {
      text = await tidyTranscript(createContext(process.env).llm, raw, req.signal);
    } catch {
      /* raw text is fine */
    }
    return NextResponse.json({ text, raw, language: data.language ?? null });
  } catch {
    return fail(504, "Transcription took too long. Try again.");
  }
}
