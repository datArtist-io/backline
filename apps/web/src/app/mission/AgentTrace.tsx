"use client";
// How the agent worked, turn by turn: what it was thinking, which tools it chose with what
// arguments, what came back, and where its own self-check sent it back to do better.
import { useState } from "react";
import type { TripAgentOutput } from "@backline/engine";

type Trace = NonNullable<TripAgentOutput["stats"]["trace"]>;

const TOOL_LABEL: Record<string, string> = {
  update_trip: "Update the trip",
  locate: "Find on the map",
  search_places: "Search places",
  check_places: "Check prices and contacts",
  research: "Research the web",
  read_document: "Read your document",
};

const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Arguments as short "key: value" pairs. Pure. */
function argText(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 220);
}

export default function AgentTrace({ agent }: { agent: TripAgentOutput }) {
  const [open, setOpen] = useState(false);
  const trace: Trace = agent.stats.trace ?? [];
  if (trace.length === 0) return null;
  const tools = trace.reduce((n, t) => n + t.calls.length, 0);
  const checks = trace.filter((t) => t.note).length;
  const who = agent.method === "agent" ? "The model chose every step" : agent.method === "mixed" ? "The model led; the autopilot finished" : "Run on autopilot";
  return (
    <section className="section" aria-labelledby="trace-title">
      <div className="lg trace">
        <button type="button" className="trace-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span>
            <span className="trace-kicker">How the agent worked</span>
            <span className="trace-title" id="trace-title">
              {trace.length} decisions · {tools} tool calls{checks ? ` · ${checks} self-check${checks > 1 ? "s" : ""}` : ""} · {secs(agent.stats.ms)}
            </span>
            <span className="trace-sub">{who}. Nothing here is scripted: each turn it read the results so far and decided what to do next.</span>
          </span>
          <span className={`trace-caret${open ? " on" : ""}`} aria-hidden="true">
            ›
          </span>
        </button>
        {open && (
          <ol className="trace-list">
            {trace.map((t) => (
              <li key={t.n} className="trace-turn">
                <p className="trace-thought">
                  <span className="trace-n">{t.n}</span>
                  {t.thought}
                  {t.by === "autopilot" && <span className="trace-by">autopilot</span>}
                </p>
                {t.calls.length > 0 && (
                  <ul className="trace-calls">
                    {t.calls.map((c, i) => (
                      <li key={i} className={c.ok ? "" : "is-failed"}>
                        <span className="trace-tool">
                          {TOOL_LABEL[c.tool] ?? c.tool} <code>{c.tool}</code>
                        </span>
                        {argText(c.args) && <span className="trace-args">{argText(c.args)}</span>}
                        <span className="trace-result">
                          {c.ok ? "→" : "✕"} {c.summary} <span className="trace-ms">{secs(c.ms)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.note && <p className="trace-note">{/^self-check/i.test(t.note) ? t.note : `Sent back: ${t.note}`}</p>}
              </li>
            ))}
            <li className="trace-turn is-end">
              <p className="trace-thought">
                <span className="trace-n">✓</span>
                Finished: {agent.stats.stop === "finished" ? "picks accepted after its checks" : agent.stats.stop}
              </p>
            </li>
          </ol>
        )}
      </div>
    </section>
  );
}
