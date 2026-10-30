"use client";
// Ask the agent about the mission it just finished. Answers cite the mission's own results;
// if the question needs new work, the agent offers to start that mission.
import { useState } from "react";
import { useRouter } from "next/navigation";

type Turn = { q: string; a?: string; facts?: { id: string; text: string }[]; suggest?: { mission: string; goal: string } | null; error?: string };

export default function FollowUp({ runId, seal, artist, autonomy }: { runId: string; seal?: string; artist: string; autonomy: "check" | "auto" }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { q: question }]);
    try {
      const res = await fetch("/api/mission/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, seal, question }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The agent couldn't answer just now.");
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: data.answer, facts: data.facts, suggest: data.suggest } : x)));
    } catch (err) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: err instanceof Error ? err.message : "Something went wrong." } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="ask-title">
      <h2 className="section-title" id="ask-title">
        Ask a follow-up
      </h2>
      {turns.length > 0 && (
        <ol className="thread">
          {turns.map((t, i) => (
            <li key={i} className="turn">
              <p className="turn-q">{t.q}</p>
              {t.a ? (
                <div className="lg turn-a">
                  <p>{t.a}</p>
                  {t.facts && t.facts.length > 0 && (
                    <details className="pitch-facts">
                      <summary>Based on {t.facts.length} findings</summary>
                      <ul>
                        {t.facts.map((f) => (
                          <li key={f.id}>{f.text}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {t.suggest && (
                    <button type="button" className="go small-go" onClick={() => router.push(`/mission?${new URLSearchParams({ goal: t.suggest!.goal, m: t.suggest!.mission, artist, mode: autonomy })}`)}>
                      Start: {t.suggest.goal}
                    </button>
                  )}
                </div>
              ) : t.error ? (
                <p className="join-error">{t.error}</p>
              ) : (
                <div className="lg turn-a" aria-busy="true">
                  <div className="skeleton bar-skel short" />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <form className="lg ask" onSubmit={ask}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={`e.g. Which of these would work best in ${artist ? `${artist}'s` : "the"} home market?`} aria-label="Ask a follow-up" />
        <button type="submit" className="go" disabled={!q.trim() || busy}>
          Ask
        </button>
      </form>
    </section>
  );
}
