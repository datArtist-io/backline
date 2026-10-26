// The agent loop. Each turn a policy (the language model, or a scripted autopilot) reads the task
// and everything done so far, says in one sentence what it's doing, and asks for up to a few tool
// calls. The tools run in parallel, their results feed the next turn, and the loop ends when the
// policy finishes or a budget (turns, tool calls, time) runs out. Every step is streamed to the
// user as it happens.
//
// It works with any chat model that can return JSON: no native function-calling needed. Model
// output is treated as untrusted: tool names and arguments are validated, repeated calls are
// answered from memory, per-tool limits are enforced, and if the model stalls the autopilot
// takes over and finishes with the same tools.
import { z } from "zod";
import type { LlmClient, ModelTier } from "../clients/llm";
import { EngineError } from "../errors";
import type { Logger, StepProgress } from "../types";
import { mapLimit, withTimeout } from "../util";

export type ToolOutput = {
  /** What the policy reads next turn: concise, factual, with ids it can refer to. */
  observation: string;
  /** One line for the user ("Found 12 hotels within 3 km"). */
  summary: string;
};

export type ToolSpec<S, A = Record<string, unknown>> = {
  name: string;
  /** One or two lines for the model: what it does and when to use it. */
  description: string;
  /** The argument shape as the model should write it, e.g. {"query": string}. */
  args: string;
  schema: z.ZodType<A, z.ZodTypeDef, unknown>;
  /** What the user sees while it runs, e.g. "Finding the National Theatre on the map". */
  label: (args: A, state: S) => string;
  run: (args: A, state: S, signal: AbortSignal | undefined) => Promise<ToolOutput>;
  /** Most calls allowed in one run. */
  limit?: number;
  timeoutMs?: number;
  /** Whether the tool can be used right now (e.g. web research after the provider ran out of quota). */
  available?: (state: S) => boolean;
};

// Tools with different argument types live in one list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool<S> = ToolSpec<S, any>;

export const defineTool = <S, A>(t: ToolSpec<S, A>): AnyTool<S> => t;

export type Action = { tool: string; args: Record<string, unknown> };
export type Decision = { thought: string; actions: Action[]; finish?: unknown; /** The model's reply as received, clipped, for diagnostics. */ raw?: string };

export type Call = { id: string; tool: string; args: Record<string, unknown>; ok: boolean; observation: string; summary: string; ms: number; cached?: boolean };
export type Turn = { n: number; by: Policy<unknown>["name"]; thought: string; calls: Call[]; note?: string };

export type TurnView<S> = {
  turn: number;
  state: S;
  turns: Turn[];
  budget: { turnsLeft: number; callsLeft: number; msLeft: number; parallel: number };
};

export type Policy<S> = { name: "model" | "autopilot"; decide: (view: TurnView<S>) => Promise<Decision> };

export type AgentLimits = {
  /** Most decisions the model may take (the autopilot has its own small cap). */
  maxTurns: number;
  maxCalls: number;
  deadlineMs: number;
  /** Most tool calls run together in one turn. */
  parallel?: number;
};

export type AgentStop = "finished" | "turns" | "calls" | "deadline" | "aborted" | "policy_failed";

/** One decision, for diagnostics: who made it, how long it took, and what came of it. */
export type DecisionLog = { n: number; by: "model" | "autopilot"; ms: number; ok: boolean; error?: string; actions: string[]; finish: boolean; raw?: string; note?: string };

/** Why the fallback took over: the model's turn budget ran out, it failed twice, or time ran short. */
export type FallbackReason = "turns" | "failures" | "time";

export type AgentRun<F> = { finish: F | null; stop: AgentStop; turns: Turn[]; calls: number; ms: number; usedFallback: boolean; fallbackReason: FallbackReason | null; decisions: DecisionLog[] };

export type RunAgentOptions<S, F> = {
  tools: AnyTool<S>[];
  state: S;
  policy: Policy<S>;
  /** Takes over if the policy fails twice in a row or time runs short. */
  fallback?: Policy<S>;
  finish: {
    schema: z.ZodType<F, z.ZodTypeDef, unknown>;
    /** Return a problem to send back ("You haven't picked a hotel"), or null to accept. */
    check?: (f: F, state: S) => string | null;
  };
  limits: AgentLimits;
  emit?: (p: StepProgress) => void;
  signal?: AbortSignal;
  log?: Logger;
};

const AUTOPILOT_MAX_TURNS = 10;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const clean = (s: unknown, max: number) => (typeof s === "string" ? clip(s.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim(), max) : "");
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** JSON with sorted keys, so the same call written twice is recognised. Pure. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

const zodIssues = (e: z.ZodError) =>
  e.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

/**
 * Read whatever shape the model replied in. Accepts {"thought","actions":[{"tool","args"}]}, a single
 * "action", a flat {"tool","query"…}, OpenAI-style tool_calls, args as a JSON string, and "finish"
 * as a field or as a tool call. Pure.
 */
export function normalizeDecision(raw: unknown): Decision {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const thought = clean(o.thought ?? o.reasoning ?? o.say ?? o.message, 280);
  const one = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? [v] : []);
  const list: unknown[] = Array.isArray(o.actions)
    ? o.actions
    : Array.isArray(o.tool_calls)
      ? o.tool_calls
      : Array.isArray(o.calls)
        ? o.calls
        : o.actions && typeof o.actions === "object"
          ? one(o.actions)
          : o.action && typeof o.action === "object"
            ? one(o.action)
            : typeof o.action === "string"
              ? // {"action": "locate", "args": {...}}
                [{ tool: o.action, args: o.args ?? o.arguments ?? o.parameters ?? o.input ?? o.action_input }]
              : typeof o.tool === "string" || typeof o.tool_name === "string"
                ? [o]
                : [];
  const actions: Action[] = list.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const a = x as Record<string, unknown>;
    const fn = a.function && typeof a.function === "object" ? (a.function as Record<string, unknown>) : null;
    const tool =
      typeof a.tool === "string" ? a.tool : typeof a.tool_name === "string" ? a.tool_name : typeof a.name === "string" ? a.name : typeof fn?.name === "string" ? fn.name : null;
    if (!tool) return [];
    let args: unknown = a.args ?? a.arguments ?? a.parameters ?? a.input ?? fn?.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = undefined;
      }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      // Flat shape: {"tool": "locate", "query": "Lagos"}.
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a)) if (!["tool", "tool_name", "name", "thought", "function", "type", "id", "args"].includes(k)) rest[k] = v;
      args = rest;
    }
    return [{ tool: tool.trim().slice(0, 40), args: args as Record<string, unknown> }];
  });
  let finish: unknown = undefined;
  if (o.finish !== undefined && o.finish !== null && o.finish !== false) finish = o.finish === true ? (o.result ?? o.answer ?? {}) : o.finish;
  else if (o.final !== undefined && o.final !== null) finish = o.final;
  const asTool = actions.findIndex((a) => a.tool === "finish");
  if (asTool >= 0) {
    finish = actions[asTool].args;
    actions.splice(asTool, 1);
  }
  return { thought, actions, finish };
}

const usable = <S>(t: AnyTool<S>, state: S) => {
  try {
    return !t.available || t.available(state);
  } catch {
    return true;
  }
};

/** The tool list as the model sees it: only tools it can use right now. Pure. */
export function renderTools<S>(tools: AnyTool<S>[], state?: S): string {
  return tools
    .filter((t) => state === undefined || usable(t, state))
    .map((t) => `- ${t.name} ${t.args}\n  ${t.description}`)
    .join("\n");
}

const indent = (s: string) => s.split("\n").join("\n    ");

/** Everything done so far, newest turns in full and older ones summarised. Pure. */
export function renderHistory(turns: Turn[], fullTurns = 3): string {
  if (turns.length === 0) return "Nothing yet.";
  return turns
    .map((t, i) => {
      const full = i >= turns.length - fullTurns;
      const lines = [`Turn ${t.n}: ${t.thought ? `"${t.thought}"` : "(no thought given)"}`];
      for (const c of t.calls) lines.push(`  ${c.tool} ${clip(stableJson(c.args), 300)}\n    → ${full ? indent(c.observation) : c.summary}`);
      if (t.note) lines.push(`  Note: ${t.note}`);
      return lines.join("\n");
    })
    .join("\n");
}

/** A policy backed by a chat model that answers in JSON. */
export function modelPolicy<S>(o: {
  llm: LlmClient;
  tier?: ModelTier;
  system: string;
  briefing: (state: S) => string;
  tools: AnyTool<S>[];
  finishShape: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Label for the model-call diagnostics. */
  purpose?: string;
}): Policy<S> {
  const anyObject = z.record(z.unknown());
  return {
    name: "model",
    async decide(view) {
      const secs = Math.max(0, Math.round(view.budget.msLeft / 1000));
      const low = view.budget.turnsLeft <= 1 || view.budget.callsLeft <= 0 || view.budget.msLeft < 25000;
      const user = [
        o.briefing(view.state),
        "",
        "## Your tools",
        renderTools(o.tools, view.state),
        "",
        "## Work so far",
        renderHistory(view.turns),
        "",
        "## Budget",
        `Turn ${view.turn}. ${view.budget.turnsLeft} turn(s) and ${view.budget.callsLeft} tool call(s) left, about ${secs} seconds.${low ? " That's nearly it: finish now with what you have." : ""}`,
        "",
        "## Reply",
        "JSON only, one of:",
        '{"thought": "<one short sentence telling the user what you are doing next>", "actions": [{"tool": "<tool name>", "args": {}}]}',
        `{"thought": "<one short sentence>", "finish": ${o.finishShape}}`,
        `Up to ${view.budget.parallel} actions per turn. Only batch actions that don't depend on each other's results. Finish only after you've seen the results you need.`,
      ].join("\n");
      const out = await o.llm.json({ tier: o.tier ?? "default", system: o.system, user, schema: anyObject, maxTokens: o.maxTokens ?? 1200, temperature: 0.2, timeoutMs: o.timeoutMs ?? 30000, signal: o.signal, purpose: `${o.purpose ?? "agent"} turn ${view.turn}` });
      return { ...normalizeDecision(out), raw: JSON.stringify(out).slice(0, 700) };
    },
  };
}

export async function runAgent<S, F>(o: RunAgentOptions<S, F>): Promise<AgentRun<F>> {
  const started = Date.now();
  const parallel = Math.max(1, Math.min(o.limits.parallel ?? 3, 6));
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const turns: Turn[] = [];
  const seen = new Map<string, Call>();
  const used = new Map<string, number>();
  let calls = 0;
  let policy = o.policy;
  let usedFallback = false;
  let fallbackReason: FallbackReason | null = null;
  let failures = 0;
  let modelTurns = 0;
  let autoTurns = 0;
  const decisions: DecisionLog[] = [];

  const emit = (p: StepProgress) => {
    try {
      o.emit?.(p);
    } catch {
      /* a broken listener must not stop the agent */
    }
  };
  const msLeft = () => o.limits.deadlineMs - (Date.now() - started);
  const end = (stop: AgentStop, finish: F | null = null): AgentRun<F> => ({ finish, stop, turns, calls, ms: Date.now() - started, usedFallback, fallbackReason, decisions });
  const switchToFallback = (why: string, reason: FallbackReason): boolean => {
    if (!o.fallback || policy === o.fallback) return false;
    policy = o.fallback;
    usedFallback = true;
    fallbackReason = reason;
    failures = 0;
    emit({ kind: "note", text: why });
    return true;
  };

  const runCall = async (a: Action, id: string, turn: number, by: Policy<S>["name"]): Promise<Call> => {
    const tool = byName.get(a.tool);
    const fail = (msg: string): Call => ({ id, tool: a.tool, args: a.args, ok: false, observation: `Error: ${msg}`, summary: msg, ms: 0 });
    if (!tool) return fail(`There's no tool called "${a.tool}". Use one of: ${o.tools.filter((t) => usable(t, o.state)).map((t) => t.name).join(", ")}.`);
    if (!usable(tool, o.state)) return fail(`${tool.name} isn't available right now. Use one of: ${o.tools.filter((t) => usable(t, o.state)).map((t) => t.name).join(", ")}.`);
    const parsed = tool.schema.safeParse(a.args ?? {});
    if (!parsed.success) return fail(`The arguments didn't fit (${zodIssues(parsed.error)}). Expected ${tool.args}.`);
    const args = parsed.data as Record<string, unknown>;
    const key = `${tool.name} ${stableJson(args)}`;
    const prev = seen.get(key);
    if (prev) return { ...prev, id, cached: true, observation: `${prev.observation}\n(You already made this exact call; this is the earlier result.)` };
    if ((used.get(tool.name) ?? 0) >= (tool.limit ?? Number.POSITIVE_INFINITY)) return fail(`${tool.name} has been used as much as allowed. Work with what you have.`);
    if (calls >= o.limits.maxCalls) return fail("The tool budget is used up. Finish now with what you have.");
    calls += 1;
    used.set(tool.name, (used.get(tool.name) ?? 0) + 1);
    let label = tool.name;
    try {
      label = clean(tool.label(args, o.state), 140) || tool.name;
    } catch {
      /* keep the tool name */
    }
    emit({ kind: "act", id, tool: tool.name, text: label, turn, by });
    const t0 = Date.now();
    try {
      const out = await withTimeout(tool.run(args, o.state, o.signal), Math.min(tool.timeoutMs ?? 30000, Math.max(3000, msLeft() + 5000)), tool.name);
      const call: Call = { id, tool: tool.name, args, ok: true, observation: clip(out.observation.trim() || "(nothing)", 2400), summary: clean(out.summary, 220) || "Done", ms: Date.now() - t0 };
      seen.set(key, call);
      emit({ kind: "saw", id, tool: tool.name, ok: true, text: call.summary, ms: call.ms, turn, by });
      return call;
    } catch (err) {
      const msg = err instanceof EngineError ? err.userMessage : "That didn't work.";
      const ms = Date.now() - t0;
      o.log?.warn("Agent tool failed", { tool: tool.name, error: errText(err) });
      emit({ kind: "saw", id, tool: tool.name, ok: false, text: msg, ms, turn, by });
      return { id, tool: tool.name, args, ok: false, observation: `Error: ${msg}`, summary: msg, ms };
    }
  };

  for (let n = 1; ; n++) {
    if (o.signal?.aborted) return end("aborted");
    if (msLeft() <= 0) return end("deadline");
    if (policy.name === "model" && modelTurns >= o.limits.maxTurns) {
      if (!switchToFallback("I've used my thinking budget, so I'm wrapping up with what I've found.", "turns")) return end("turns");
    }
    if (policy.name === "autopilot" && autoTurns >= AUTOPILOT_MAX_TURNS) return end("turns");

    const by = policy.name;
    const view: TurnView<S> = {
      turn: n,
      state: o.state,
      turns,
      budget: { turnsLeft: Math.max(0, o.limits.maxTurns - modelTurns - 1), callsLeft: Math.max(0, o.limits.maxCalls - calls), msLeft: msLeft(), parallel },
    };
    let d: Decision;
    const t0 = Date.now();
    try {
      if (by === "model") modelTurns += 1;
      else autoTurns += 1;
      const out = await withTimeout(policy.decide(view), Math.max(2000, msLeft()), `${by} decision`);
      d = { ...normalizeDecision(out), raw: out.raw };
      failures = 0;
      decisions.push({ n, by, ms: Date.now() - t0, ok: true, actions: d.actions.map((a) => a.tool), finish: d.finish !== undefined, raw: d.actions.length === 0 && d.finish === undefined ? d.raw : undefined });
    } catch (err) {
      failures += 1;
      decisions.push({ n, by, ms: Date.now() - t0, ok: false, error: errText(err).slice(0, 240), actions: [], finish: false });
      o.log?.warn("Agent decision failed", { by, turn: n, error: errText(err) });
      if (o.signal?.aborted) return end("aborted");
      if (by === "model" && failures >= 2 && switchToFallback("The model isn't answering well, so I'm finishing the job on autopilot.", "failures")) continue;
      if (by === "model" && msLeft() < Math.min(40000, o.limits.deadlineMs * 0.35) && switchToFallback("Time is short, so I'm finishing the job on autopilot.", "time")) continue;
      if (failures >= 2) return end("policy_failed");
      continue;
    }

    const thought = d.thought || (d.actions.length ? "Working on it" : "Wrapping up");
    emit({ kind: "think", text: thought, turn: n, by });
    const turn: Turn = { n, by, thought, calls: [] };
    turns.push(turn);

    if (d.actions.length === 0) {
      if (d.finish !== undefined) {
        const parsed = o.finish.schema.safeParse(d.finish);
        if (!parsed.success) {
          turn.note = `Your finish didn't match the shape (${zodIssues(parsed.error)}). Fix it and finish again.`;
          decisions[decisions.length - 1].note = turn.note;
          if (by === "autopilot") return end("policy_failed");
          continue;
        }
        const problem = o.finish.check?.(parsed.data, o.state) ?? null;
        const lastChance = by === "autopilot" || o.limits.maxTurns - modelTurns <= 0 || msLeft() < Math.min(20000, o.limits.deadlineMs * 0.15);
        if (problem && !lastChance) {
          turn.note = problem;
          decisions[decisions.length - 1].note = `finish sent back: ${problem}`;
          continue;
        }
        return end("finished", parsed.data);
      }
      turn.note = "You didn't call a tool or finish. Do one or the other.";
      decisions[decisions.length - 1].note = "no tool and no finish";
      if (by === "autopilot") return end("policy_failed");
      continue;
    }

    const batch = d.actions.slice(0, parallel);
    if (d.actions.length > batch.length) turn.note = `Only the first ${batch.length} actions ran. Ask for the rest next turn if you still need them.`;
    else if (d.finish !== undefined) turn.note = "You asked for tools and finished in the same turn. The tools ran; finish next turn once you've read their results.";
    turn.calls = await mapLimit(batch, batch.length, (a, i) => runCall(a, `${n}.${i + 1}`, n, by));
  }
}
