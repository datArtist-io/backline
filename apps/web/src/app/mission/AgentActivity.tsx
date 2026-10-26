"use client";
// The agent's work, live: what it decided to do next, each tool it ran, and what came back.
// Collapses to one line when the agent is done.
import { useEffect, useMemo, useState } from "react";
import type { StepProgress } from "@backline/engine";

type Call = { id: string; act: StepProgress; saw?: StepProgress };
type Group = { thought: StepProgress | null; calls: Call[]; notes: StepProgress[] };

/** Thoughts with the tool calls that followed them; each "saw" is paired with its "act". */
export function groupActivity(entries: StepProgress[]): Group[] {
  const groups: Group[] = [];
  const calls = new Map<string, Call>();
  let cur: Group | null = null;
  for (const e of entries) {
    if (e.kind === "think") {
      cur = { thought: e, calls: [], notes: [] };
      groups.push(cur);
      continue;
    }
    if (!cur) {
      cur = { thought: null, calls: [], notes: [] };
      groups.push(cur);
    }
    if (e.kind === "note") cur.notes.push(e);
    else if (e.kind === "act" && e.id) {
      const c = { id: e.id, act: e };
      calls.set(e.id, c);
      cur.calls.push(c);
    } else if (e.kind === "saw" && e.id) {
      const c = calls.get(e.id);
      if (c) c.saw = e;
      else cur.calls.push({ id: e.id, act: { ...e, kind: "act" }, saw: e });
    }
  }
  return groups;
}

const ICON: Record<string, string> = {
  locate: "⌖",
  search_places: "⌕",
  check_places: "✓",
  research: "◎",
  read_document: "¶",
  update_trip: "✎",
  hotel_rates: "⌂",
};

export default function AgentActivity({ entries, running }: { entries: StepProgress[]; running: boolean }) {
  const groups = useMemo(() => groupActivity(entries), [entries]);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!running) setOpen(false);
  }, [running]);
  if (groups.length === 0) return null;
  const steps = entries.filter((e) => e.kind === "act").length;
  const failed = entries.filter((e) => e.kind === "saw" && e.ok === false).length;
  const shown = open ? groups : groups.slice(-1);
  const hidden = groups.length - shown.length;
  return (
    <section className={`lg activity${running ? " is-running" : ""}`} aria-label="What the agent is doing">
      <div className="activity-head">
        <span className="activity-pulse" aria-hidden="true" />
        <p className="activity-title">{running ? "Working on it" : `Researched in ${steps} step${steps === 1 ? "" : "s"}${failed ? `, ${failed} retried` : ""}`}</p>
        {(groups.length > 1 || !open) && (
          <button type="button" className="link-btn activity-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide steps" : `Show all ${groups.length}`}
          </button>
        )}
      </div>
      <ol className="activity-list" aria-live="polite">
        {hidden > 0 && <li className="activity-more muted small">{hidden} earlier step{hidden === 1 ? "" : "s"}</li>}
        {shown.map((g, i) => (
          <li key={`${g.thought?.turn ?? "x"}-${i}`} className="activity-group">
            {g.thought && (
              <p className="activity-thought">
                {g.thought.text}
                {g.thought.by === "autopilot" && <span className="activity-tag">Autopilot</span>}
              </p>
            )}
            {g.notes.map((n, j) => (
              <p key={j} className="activity-note">
                {n.text}
              </p>
            ))}
            {g.calls.length > 0 && (
              <ul className="activity-calls">
                {g.calls.map((c) => (
                  <li key={c.id} className={`activity-call ${!c.saw ? "is-busy" : c.saw.ok === false ? "is-failed" : "is-ok"}`}>
                    <span className="activity-icon" aria-hidden="true">
                      {ICON[c.act.tool ?? ""] ?? "•"}
                    </span>
                    <span className="activity-body">
                      <span className="activity-label">{c.act.text}</span>
                      {c.saw && (
                        <span className="activity-result">
                          {c.saw.text}
                          {c.saw.ms != null && c.saw.ms > 0 ? <span className="activity-ms"> · {(c.saw.ms / 1000).toFixed(1)}s</span> : null}
                        </span>
                      )}
                    </span>
                    <span className="activity-state" aria-hidden="true" />
                    <span className="sr-only">{!c.saw ? "running" : c.saw.ok === false ? "didn't work" : "done"}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
