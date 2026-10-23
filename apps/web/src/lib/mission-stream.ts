// Client for the /api/mission event stream (POST + Server-Sent Events over fetch).
import type { CheckpointOption, DocumentText, MissionType, Plan, StepProgress } from "@backline/engine";

export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "waiting";
export type StepState = { id: string; title: string; status: StepStatus; ms?: number; error?: string; checkpoint: string | null; cached?: boolean };

export type Evidence =
  | { source: "qloo"; entityId: string; label: string; affinity?: number; query: string }
  | { source: "web"; url: string; title: string; retrievedAt: string }
  | { source: "derived"; label: string; basis: string };

export type StepResult = { data: unknown; evidence: Evidence[]; notes?: string[] };

export type Planned = {
  runId: string;
  plan: Plan;
  goal: string;
  ack: string | null;
  autonomy: "check" | "auto";
  steps: { id: string; title: string; checkpoint: string | null }[];
  checkpoints: { id: string; before: string; title: string }[];
  resumed: boolean;
};

export type CheckpointRequest = { id: string; title: string; hint: string; min: number; max: number; options: CheckpointOption[] };

export type MissionRequest = {
  goal?: string;
  artist?: string;
  location?: string;
  mission?: MissionType;
  autonomy: "check" | "auto";
  runId?: string;
  selections?: Record<string, string[]>;
  defaultArtist?: string;
  profile?: import("@backline/engine").Profile;
  today?: string;
  documents?: DocumentText[];
  /** Ask the server for diagnostics (development, or BACKLINE_DEBUG=1). */
  debug?: boolean;
};

/** What debug mode reports: the planner's path, every model call's timing and outcome, and warnings. */
export type MissionDebug = {
  planner: { method: string; fallbackReason: string | null } | null;
  llm: { at: number; purpose: string | null; tier: string; model: string; ms: number; ok: boolean; status: number | null; finish: string | null; inChars: number; outChars: number; error: string | null }[];
  /** Web research calls (Claude, Tavily, Wikivoyage/Wikipedia). */
  web?: { at: number; purpose: string; model: string; ms: number; ok: boolean; status: number | null; error: string | null }[];
  /** Model tiers resting after repeated failures. */
  resting?: { tier: string; until: number }[];
  logs: { level: string; msg: string; meta?: unknown; at: number }[];
  usage: Record<string, number>;
};

export type MissionHandlers = {
  onPlanned: (p: Planned) => void;
  onStep: (id: string, patch: Partial<StepState>, result?: StepResult) => void;
  /** Live narration from a running step (the agent's thoughts and tool calls). */
  onProgress?: (id: string, p: StepProgress) => void;
  onCheckpoint: (c: CheckpointRequest) => void;
  onNeeds: (field: string, message: string, plan: Plan, preview: string[]) => void;
  onReply: (message: string, suggestions: string[], plan: Plan) => void;
  onDone: (status: "succeeded" | "partial" | "failed" | "waiting") => void;
  onError: (message: string) => void;
  onDebug?: (d: MissionDebug) => void;
};

export async function streamMission(body: MissionRequest, h: MissionHandlers, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/mission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch {
    if (!signal.aborted) h.onError("Couldn't reach the agent. Check your connection and try again.");
    return;
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    h.onError(data.error || "The mission couldn't start. Try again.");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const handle = (event: string, raw: string) => {
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }
    const skill = d.skill as string;
    switch (event) {
      case "mission.planned":
        h.onPlanned(d as unknown as Planned);
        break;
      case "mission.needs":
        finished = true;
        h.onNeeds(d.field as string, d.message as string, d.plan as Plan, (d.preview as string[]) ?? []);
        break;
      case "mission.reply":
        finished = true;
        h.onReply(d.message as string, (d.suggestions as string[]) ?? [], d.plan as Plan);
        break;
      case "step.started":
        h.onStep(skill, { status: "running" });
        break;
      case "step.progress":
        if (d.progress && typeof d.progress === "object") h.onProgress?.(skill, d.progress as StepProgress);
        break;
      case "step.succeeded":
        h.onStep(skill, { status: "succeeded", ms: d.ms as number, cached: Boolean(d.cached) }, d.result as StepResult);
        break;
      case "step.failed":
        h.onStep(skill, { status: "failed", ms: d.ms as number, error: d.error as string });
        break;
      case "step.skipped":
        h.onStep(skill, { status: "skipped", error: d.reason as string });
        break;
      case "step.waiting":
        h.onStep(skill, { status: "waiting", error: d.reason as string });
        break;
      case "mission.checkpoint":
        h.onCheckpoint(d as unknown as CheckpointRequest);
        break;
      case "mission.debug":
        h.onDebug?.(d as unknown as MissionDebug);
        break;
      case "mission.completed":
        finished = true;
        h.onDone(d.status as "succeeded" | "partial" | "failed" | "waiting");
        break;
      case "mission.error":
        finished = true;
        h.onError((d.error as string) || "The mission couldn't run. Try again.");
        break;
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        if (data.length) handle(event, data.join("\n"));
      }
    }
  } catch {
    if (signal.aborted) return;
  }
  if (!finished && !signal.aborted) h.onError("The connection to the agent dropped. Try again.");
}
