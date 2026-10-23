// Attaching files in the browser: shrink big photos, send each file to /api/documents to be read,
// and keep the text for the mission. Files themselves never leave this flow.
import type { DocumentText } from "@backline/engine";

export const ACCEPT = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.tsv,.json,.ics,.eml,.html,.htm,.rtf,image/*";
const MAX_BYTES = 4 * 1024 * 1024;

export type Attachment = { id: string; name: string; status: "reading" | "ready" | "error"; doc?: DocumentText; error?: string };

/** Photos from phones are often 5–12 MB: redraw them at a readable size as JPEG. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= MAX_BYTES * 0.8 || typeof createImageBitmap !== "function") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** Read one file into text, or explain plainly why it couldn't be read. */
export async function readFile(file: File, signal?: AbortSignal): Promise<DocumentText> {
  const ready = await shrinkImage(file);
  if (ready.size > MAX_BYTES) throw new Error("That file is over 4 MB. Try a smaller version, or a photo of the page that matters.");
  const form = new FormData();
  form.append("file", ready, ready.name);
  let res: Response;
  try {
    res = await fetch("/api/documents", { method: "POST", body: form, signal });
  } catch {
    throw new Error("Couldn't upload that file. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { document?: DocumentText; error?: string };
  if (!res.ok || !data.document) throw new Error(data.error || "Couldn't read that file.");
  return data.document;
}

export const newId = () => Math.random().toString(36).slice(2, 10);
