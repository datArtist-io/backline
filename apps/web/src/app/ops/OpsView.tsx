"use client";
// The private monitor: services up or down (with timings), settings and their modes, usage, and this
// server's recent missions and warnings. Refreshes itself; the full service check runs on demand.
import { useCallback, useEffect, useRef, useState } from "react";

type Service = { service: string; configured: boolean; ok: boolean | null; ms: number | null; status: number | null; detail: string | null };
type Feed = {
  at: string;
  deploy: { env: string | null; commit: string | null; message: string | null; region: string | null; url: string | null };
  instance: { since: string; memoryMb: number; missions: number; withProblems: number };
  services: Service[] | null;
  config: { name: string; set: boolean; note?: string }[];
  usage: Record<string, number | null> | null;
  runs: { at: number; goal: string; status: string; ms: number; planner: string | null; failed: string[]; signedIn: boolean; country: string | null }[];
  logs: { at: number; level: "warn" | "error"; msg: string }[];
};

const ago = (t: number | string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};
const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

export default function OpsView({ email }: { email: string }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [services, setServices] = useState<{ list: Service[]; at: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<"all" | "error">("all");
  const timer = useRef<number | null>(null);

  const load = useCallback(async (check = false) => {
    if (check) setChecking(true);
    try {
      const r = await fetch(`/api/ops${check ? "?check=1" : ""}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "Not allowed: this account isn't in ADMIN_EMAILS." : `Feed error ${r.status}`);
      const j = (await r.json()) as Feed;
      setFeed(j);
      if (j.services) setServices({ list: j.services, at: Date.now() });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load");
    } finally {
      if (check) setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    timer.current = window.setInterval(() => document.visibilityState === "visible" && void load(false), 15_000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  const down = services?.list.filter((s) => s.ok === false) ?? [];
  const logs = (feed?.logs ?? []).filter((l) => logFilter === "all" || l.level === "error");

  return (
    <main className="ops">
      <header className="ops-head">
        <div>
          <h1>Backline ops</h1>
          <p>
            Private · signed in as {email}
            {feed?.deploy.commit ? ` · ${feed.deploy.env ?? ""} ${feed.deploy.commit}` : ""}
            {feed?.deploy.region ? ` · ${feed.deploy.region}` : ""}
            {feed ? ` · updated ${ago(feed.at)}` : ""}
          </p>
        </div>
        <div className="ops-acts">
          <button type="button" onClick={() => load(true)} disabled={checking}>{checking ? "Checking…" : "Check all services"}</button>
          <a href="/">Back to Backline</a>
        </div>
      </header>
      {error && <p className="ops-err" role="alert">{error}</p>}

      <section className={`ops-banner ${services ? (down.length ? "is-bad" : "is-good") : ""}`} aria-live="polite">
        {!services ? "Checking services…" : down.length ? `${down.length} service${down.length === 1 ? "" : "s"} failing: ${down.map((d) => d.service).join(", ")}` : "All services answering"}
        {services && <small> · checked {ago(services.at)}</small>}
      </section>

      <div className="ops-grid">
        <section className="ops-card ops-wide">
          <h2>Services</h2>
          <table>
            <thead><tr><th>Service</th><th>Status</th><th>Time</th><th>Detail</th></tr></thead>
            <tbody>
              {(services?.list ?? []).map((s) => (
                <tr key={s.service} className={s.ok === false ? "bad" : s.ok ? "good" : ""}>
                  <td>{s.service}</td>
                  <td><span className={`ops-dot ${s.ok === false ? "bad" : s.ok ? "good" : "idle"}`} />{!s.configured ? "not set" : s.ok === false ? `down${s.status ? ` (${s.status})` : ""}` : s.ok ? "ok" : "set"}</td>
                  <td>{s.ms != null ? secs(s.ms) : "–"}</td>
                  <td className="ops-muted">{s.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="ops-card">
          <h2>This server</h2>
          <dl className="ops-stats">
            <div><dt>Missions</dt><dd>{feed?.instance.missions ?? "–"}</dd></div>
            <div><dt>With problems</dt><dd>{feed?.instance.withProblems ?? "–"}</dd></div>
            <div><dt>Memory</dt><dd>{feed ? `${feed.instance.memoryMb} MB` : "–"}</dd></div>
            <div><dt>Up since</dt><dd>{feed ? ago(feed.instance.since) : "–"}</dd></div>
          </dl>
          <p className="ops-note">Serverless: each instance keeps its own short history, cleared on restart.</p>
        </section>

        <section className="ops-card">
          <h2>Usage</h2>
          {feed?.usage ? (
            <dl className="ops-stats">
              {Object.entries(feed.usage).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? "–"}</dd></div>)}
            </dl>
          ) : (
            <p className="ops-note">Add <code>SUPABASE_SECRET_KEY</code> in Vercel to see accounts, trips, searches and payments.</p>
          )}
        </section>

        <section className="ops-card ops-wide">
          <h2>Recent missions <small>(this server)</small></h2>
          {feed?.runs.length ? (
            <table>
              <thead><tr><th>When</th><th>Request</th><th>Result</th><th>Time</th><th>Planner</th><th>Who</th></tr></thead>
              <tbody>
                {feed.runs.map((r, i) => (
                  <tr key={r.at + ":" + i} className={r.status === "failed" || r.failed.length ? "bad" : ""}>
                    <td>{ago(r.at)}</td>
                    <td>{r.goal}</td>
                    <td>{r.status}{r.failed.length ? ` · failed: ${r.failed.join(", ")}` : ""}</td>
                    <td>{secs(r.ms)}</td>
                    <td>{r.planner === "keywords" ? "rules (model down)" : r.planner ?? "–"}</td>
                    <td>{r.signedIn ? "signed in" : "guest"}{r.country ? ` · ${r.country}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ops-note">No missions on this server yet.</p>
          )}
        </section>

        <section className="ops-card ops-wide">
          <h2>
            Warnings and errors <small>(this server)</small>
            <span className="ops-tabs">
              <button type="button" className={logFilter === "all" ? "on" : ""} onClick={() => setLogFilter("all")}>All</button>
              <button type="button" className={logFilter === "error" ? "on" : ""} onClick={() => setLogFilter("error")}>Errors</button>
            </span>
          </h2>
          {logs.length ? (
            <ul className="ops-logs">
              {logs.map((l, i) => (
                <li key={l.at + ":" + i} className={l.level}>
                  <time>{ago(l.at)}</time>
                  <code>{l.msg}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ops-note">Nothing logged on this server yet.</p>
          )}
        </section>

        <section className="ops-card ops-wide">
          <h2>Settings</h2>
          <ul className="ops-config">
            {(feed?.config ?? []).map((c) => (
              <li key={c.name}>
                <span className={`ops-dot ${c.set ? "good" : "idle"}`} />
                <b>{c.name}</b>
                <span className="ops-muted">{c.set ? c.note ?? "set" : "not set"}</span>
              </li>
            ))}
          </ul>
          <p className="ops-note">Names and modes only. Key values are never shown or sent to the browser.</p>
        </section>
      </div>
    </main>
  );
}
