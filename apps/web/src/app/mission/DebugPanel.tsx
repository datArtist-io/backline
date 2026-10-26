"use client";
// Diagnostics for developers (open a mission with ?debug=1): which path the planner took, every
// model call's timing and outcome, each agent decision, and warnings. Never shows keys or content.
import type { TripAgentOutput, TripPlanOutput, TripRoutesOutput } from "@backline/engine";
import type { MissionDebug, StepResult, StepState } from "@/lib/mission-stream";

const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export default function DebugPanel({ debug, results, steps }: { debug: MissionDebug | null; results: Record<string, StepResult>; steps: StepState[] }) {
  const agent = results["trip.agent"]?.data as TripAgentOutput | undefined;
  const plan = results["trip.plan"]?.data as TripPlanOutput | undefined;
  const routes = results["trip.routes"]?.data as TripRoutesOutput | undefined;
  return (
    <details className="lg debug" open>
      <summary>Diagnostics</summary>
      <div className="debug-grid">
        <p>
          <b>Planner</b> {debug?.planner ? `${debug.planner.method}${debug.planner.fallbackReason ? ` (${debug.planner.fallbackReason})` : ""}` : "…"}
        </p>
        <p>
          <b>Steps</b> {steps.map((st) => `${st.id} ${st.status}${st.ms != null ? ` ${s(st.ms)}` : ""}`).join(" · ") || "…"}
        </p>
        {agent && (
          <p>
            <b>Agent</b> {agent.method}, {agent.stats.turns} turns, {agent.stats.calls} tool calls, {s(agent.stats.ms)}, stopped: {agent.stats.stop}
          </p>
        )}
        {plan && (
          <p>
            <b>Plan</b> {plan.method}
            {plan.fallbackReason ? ` (${plan.fallbackReason})` : ""}
          </p>
        )}
        {debug && (debug.resting?.length ?? 0) > 0 && (
          <p>
            <b>Resting</b> {debug.resting!.map((r) => `${r.tier} model until ${new Date(r.until).toLocaleTimeString()}`).join(", ")}
          </p>
        )}
        {routes && (
          <p>
            <b>Routes</b> {routes.provider}, {routes.days.filter((d) => d.stops.length >= 2).length} day(s) routed, {routes.points.length} points
          </p>
        )}
      </div>
      {agent && agent.stats.decisions.length > 0 && (
        <table className="debug-table">
          <thead>
            <tr>
              <th>#</th>
              <th>by</th>
              <th>time</th>
              <th>result</th>
            </tr>
          </thead>
          <tbody>
            {agent.stats.decisions.map((d, i) => (
              <tr key={i} className={d.ok ? "" : "bad"}>
                <td>{d.n}</td>
                <td>{d.by}</td>
                <td>{s(d.ms)}</td>
                <td>
                  {d.ok ? (d.finish ? "finish" : d.actions.join(", ") || "nothing") : d.error}
                  {d.note && <em> · {d.note}</em>}
                  {d.raw && <code>{d.raw}</code>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {debug && debug.llm.length > 0 && (
        <table className="debug-table">
          <thead>
            <tr>
              <th>model call</th>
              <th>time</th>
              <th>outcome</th>
            </tr>
          </thead>
          <tbody>
            {debug.llm.map((c, i) => (
              <tr key={i} className={c.ok ? "" : "bad"}>
                <td>
                  {c.purpose ?? "call"} · {c.tier} · {c.model}
                </td>
                <td>{s(c.ms)}</td>
                <td>
                  {c.ok ? `ok (${c.finish ?? "?"}, ${c.inChars}→${c.outChars} chars)` : `${c.status ?? "network"}: ${c.error ?? "failed"}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {debug && (debug.web?.length ?? 0) > 0 && (
        <table className="debug-table">
          <thead>
            <tr>
              <th>web call</th>
              <th>time</th>
              <th>outcome</th>
            </tr>
          </thead>
          <tbody>
            {debug.web!.map((c, i) => (
              <tr key={i} className={c.ok ? "" : "bad"}>
                <td>
                  {c.purpose} · {c.model}
                </td>
                <td>{s(c.ms)}</td>
                <td>{c.ok ? "ok" : `${c.status ?? "network"}: ${c.error ?? "failed"}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {debug && debug.logs.length > 0 && (
        <ul className="debug-logs">
          {debug.logs.map((l, i) => (
            <li key={i} className={l.level}>
              {s(l.at)} {l.msg} {l.meta ? <code>{JSON.stringify(l.meta).slice(0, 300)}</code> : null}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
