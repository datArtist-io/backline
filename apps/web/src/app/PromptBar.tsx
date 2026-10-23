"use client";

// Liquid-glass prompt with push-to-talk voice input in any language, and attachments: drop, paste
// or pick a file (PDF, Word, Excel, PowerPoint, text, a photo of a flyer) and the agent plans from it.
// Hold the mic (or hold Space/Enter while it's focused) to record; release to transcribe; Escape cancels.
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentText } from "@backline/engine";
import { voice } from "@/lib/voice";
import { ACCEPT, newId, readFile, type Attachment } from "@/lib/attach";

const MAX_FILES = 3;

type Mode = "idle" | "listening" | "transcribing";
const BARS = 28;
const MAX_MS = 60_000;
const MIN_MS = 350;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

type Props = { onSubmit: (text: string, docs: DocumentText[]) => void; placeholder?: string };
const MAX_CHARS = 2000;
const AUTO_START_MS = 1800;

export default function PromptBar({ onSubmit, placeholder = "Ask about any artist" }: Props) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const readyDocs = () => filesRef.current.flatMap((f) => (f.status === "ready" && f.doc ? [f.doc] : []));
  const onSubmitRef = useRef((text: string) => onSubmit(text, readyDocs()));
  onSubmitRef.current = (text: string) => onSubmit(text, readyDocs());
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0));
  const pickerRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const attach = useCallback((list: FileList | File[]) => {
    const room = MAX_FILES - filesRef.current.length;
    const picked = Array.from(list).slice(0, Math.max(0, room));
    if (picked.length === 0) {
      setError(`You can attach up to ${MAX_FILES} files.`);
      return;
    }
    setError(null);
    for (const file of picked) {
      const id = newId();
      setFiles((prev) => [...prev, { id, name: file.name, status: "reading" }]);
      readFile(file)
        .then((doc) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "ready", doc } : f))))
        .catch((e: unknown) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: e instanceof Error ? e.message : "Couldn't read that file." } : f))));
    }
  }, []);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  // After a voice note is tidied, the agent starts on its own unless the user touches the text.
  const [autoStart, setAutoStart] = useState(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [multiline, setMultiline] = useState(false);
  const cancelAuto = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = null;
    setAutoStart(false);
  }, []);
  const pressedRef = useRef(false);
  // Tap the mic to start and tap again to stop, or hold it down and release.
  const latchedRef = useRef(false);
  const downAtRef = useRef(0);
  const cancelRef = useRef(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const releaseAudio = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    voice.level = 0;
    voice.listening = false;
    setBars(Array(BARS).fill(0));
  }, []);

  const meter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.min(1, Math.sqrt(sum / data.length) * 4.5);
      voice.level = voice.level * 0.7 + rms * 0.3;
      if (frame++ % 2 === 0) setBars((b) => [...b.slice(1), voice.level]);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const transcribe = useCallback(async (blob: Blob) => {
    setMode("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't transcribe that. Try again.");
      const text = (data.text || "").trim();
      if (text) {
        const base = valueRef.current.trim();
        const next = (base ? `${base}\n${text}` : text).slice(0, MAX_CHARS);
        setValue(next);
        setAutoStart(true);
        autoTimer.current = setTimeout(() => {
          setAutoStart(false);
          onSubmitRef.current(next.trim());
        }, AUTO_START_MS);
      } else {
        setError("Didn't catch that. Hold the mic and try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't transcribe that. Try again.");
    } finally {
      setMode("idle");
      inputRef.current?.focus();
    }
  }, []);

  const start = useCallback(async () => {
    if (mode !== "idle") return;
    setError(null);
    cancelRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice isn't available in this browser. You can still type.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Microphone access is off. Allow it in your browser's site settings.");
      return;
    }
    // Released before the mic was ready (often while the permission prompt was open): keep listening until tapped again.
    if (!pressedRef.current) latchedRef.current = true;
    streamRef.current = stream;
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const duration = Date.now() - startedRef.current;
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      recRef.current = null;
      releaseAudio();
      latchedRef.current = false;
      if (cancelRef.current) {
        setMode("idle");
        return;
      }
      if (duration < MIN_MS || blob.size === 0) {
        setMode("idle");
        setError("That was too short. Tap the mic, speak, then tap again.");
        return;
      }
      transcribe(blob);
    };
    recRef.current = rec;
    startedRef.current = Date.now();
    rec.start();
    voice.listening = true;
    setMode("listening");
    meter(stream);
    timerRef.current = setTimeout(() => {
      if (recRef.current?.state === "recording") recRef.current.stop();
    }, MAX_MS);
  }, [meter, mode, releaseAudio, transcribe]);

  const stop = useCallback((cancel = false) => {
    pressedRef.current = false;
    cancelRef.current = cancel;
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  useEffect(() => {
    if (mode !== "listening") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, stop]);

  useEffect(
    () => () => {
      cancelRef.current = true;
      if (recRef.current?.state === "recording") recRef.current.stop();
      releaseAudio();
    },
    [releaseAudio]
  );

  // Grow with the text, up to about six lines, then scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(el.scrollHeight, 180);
    el.style.height = `${h}px`;
    setMultiline(el.scrollHeight > 56);
  }, [value]);

  useEffect(() => () => cancelAuto(), [cancelAuto]);

  const hasText = value.trim().length > 0;
  const level = bars[bars.length - 1] ?? 0;
  const reading = files.some((f) => f.status === "reading");
  const hasDocs = files.some((f) => f.status === "ready");
  const canSend = (hasText || hasDocs) && !reading && mode === "idle";
  const fileError = files.find((f) => f.status === "error")?.error;

  return (
    <div className="prompt-wrap">
      <form
        className={`lg prompt is-${mode}${multiline ? " is-multiline" : ""}${dragging ? " is-dragging" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          cancelAuto();
          if (canSend) onSubmit(value.trim(), readyDocs());
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          attach(e.dataTransfer.files);
        }}
      >
        <label htmlFor="prompt" className="sr-only">
          Artist or question for the agent
        </label>
        <div className="prompt-field">
          <textarea
            id="prompt"
            ref={inputRef}
            rows={1}
            className="prompt-input"
            value={value}
            onChange={(e) => {
              cancelAuto();
              setValue(e.target.value);
              if (error) setError(null);
            }}
            onFocus={cancelAuto}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            onPaste={(e) => {
              // Pasting a screenshot or file attaches it.
              if (e.clipboardData.files.length && !e.clipboardData.getData("text")) {
                e.preventDefault();
                attach(e.clipboardData.files);
              }
            }}
            placeholder={mode === "idle" ? (files.length ? "What should I do with it? (optional)" : placeholder) : mode === "transcribing" ? "Writing it down…" : ""}
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_CHARS}
            readOnly={mode !== "idle"}
          />
          {mode === "listening" && (
            <div className="wave" aria-hidden="true">
              {bars.map((b, i) => (
                <span key={i} style={{ transform: `scaleY(${0.12 + b * 0.88})` }} />
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="icon-btn attach"
          aria-label="Attach a document or photo"
          title="Attach a document or photo"
          disabled={mode !== "idle" || files.length >= MAX_FILES}
          onClick={() => pickerRef.current?.click()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20.5 11.3 12.2 19.6a5.2 5.2 0 0 1-7.4-7.4l8.6-8.6a3.4 3.4 0 0 1 4.9 4.9l-8.6 8.5a1.7 1.7 0 0 1-2.4-2.4l7.9-7.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          ref={pickerRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) attach(e.target.files);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          className="icon-btn mic"
          aria-label={mode === "listening" ? "Stop and transcribe" : "Speak your goal"}
          title={mode === "listening" ? "Tap to stop" : "Tap to speak, or hold"}
          aria-pressed={mode === "listening"}
          disabled={mode === "transcribing"}
          onPointerDown={(e) => {
            e.preventDefault();
            if (mode === "listening") {
              // Second tap while latched: stop.
              stop(false);
              return;
            }
            e.currentTarget.setPointerCapture(e.pointerId);
            pressedRef.current = true;
            downAtRef.current = Date.now();
            start();
          }}
          onPointerUp={() => {
            if (latchedRef.current) return;
            if (Date.now() - downAtRef.current < 350) {
              // A tap, not a hold: keep listening until the next tap.
              pressedRef.current = false;
              latchedRef.current = true;
              return;
            }
            stop(false);
          }}
          onPointerCancel={() => {
            if (!latchedRef.current) stop(true);
          }}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              if (mode === "listening") stop(false);
              else {
                pressedRef.current = false;
                latchedRef.current = true;
                start();
              }
            }
          }}
          style={{ ["--ring" as string]: 1 + level * 0.9 }}
        >
          <span className="mic-ring" aria-hidden="true" />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="8.5" y="3" width="7" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        {canSend && (
          <button type="submit" className="icon-btn send" aria-label="Start">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </form>

      {files.length > 0 && (
        <ul className="prompt-files" aria-label="Attached files">
          {files.map((f) => (
            <li key={f.id} className={`file-chip is-${f.status}`} title={f.error ?? f.name}>
              <span className="file-chip-dot" aria-hidden="true" />
              <span className="file-chip-name">{f.name}</span>
              <span className="file-chip-state">{f.status === "reading" ? "Reading" : f.status === "ready" ? "Ready" : "Couldn't read"}</span>
              <button type="button" className="file-chip-x" aria-label={`Remove ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {mode === "listening" ? "Listening" : mode === "transcribing" ? "Transcribing" : reading ? "Reading your file" : ""}
      </p>
      {(error || fileError) && (
        <p className="prompt-error" role="alert">
          {error ?? fileError}
        </p>
      )}
      {autoStart && (
        <p className="prompt-auto" aria-live="polite">
          <span className="prompt-auto-bar" aria-hidden="true" />
          Starting now. Tap the text to edit first.
        </p>
      )}
    </div>
  );
}
