"use client";
// Sections that show what the agent learned about the fanbase. Shared by every mission.
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ArtistResolveOutput, FansDemographicsOutput, FansDnaOutput, FansProfileOutput } from "@backline/engine";
import type { Evidence, StepResult, StepState } from "@/lib/mission-stream";

export function HeaderSkeleton({ name }: { name: string }) {
  return (
    <section className="artist">
      <div className="avatar skeleton" />
      <div>
        <h1 className="artist-name">{name}</h1>
        <p className="artist-sub">Finding the artist</p>
      </div>
    </section>
  );
}

export function ArtistHeader({ data, altHref }: { data: ArtistResolveOutput; altHref: (name: string) => string }) {
  const { artist, alternatives } = data;
  const genres = artist.properties.primary_genres;
  const genreText = Array.isArray(genres) ? genres.slice(0, 3).join(", ") : typeof genres === "string" ? genres : null;
  return (
    <section className="artist">
      {artist.image ? <img className="avatar" src={artist.image} alt="" width={88} height={88} /> : <div className="avatar" />}
      <div>
        <h1 className="artist-name">{artist.name}</h1>
        {genreText && <p className="artist-sub">{genreText}</p>}
        {alternatives.length > 0 && (
          <p className="alts">
            Not who you meant?{" "}
            {alternatives.slice(0, 3).map((a, i) => (
              <span key={a.id}>
                <Link href={altHref(a.name)}>{a.name}</Link>
                {i < Math.min(alternatives.length, 3) - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

export function Placeholder({ steps, id, label }: { steps: StepState[]; id: string; label: string }) {
  const s = steps.find((x) => x.id === id);
  if (s?.status === "failed" || s?.status === "skipped") {
    return (
      <section className="section">
        <h2 className="section-title">{label}</h2>
        <p className="muted">{s.error}</p>
      </section>
    );
  }
  return (
    <section className="section" aria-busy="true">
      <h2 className="section-title">{label}</h2>
      <div className="skeleton bar-skel" />
      <div className="skeleton bar-skel short" />
    </section>
  );
}

export function Notes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return (
    <ul className="notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

export function Receipts({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <details className="receipts">
      <summary>See the data behind this ({evidence.length})</summary>
      <ul>
        {evidence.slice(0, 60).map((e, i) => (
          <li key={i}>
            {e.source === "qloo" && (
              <>
                <span>{e.label}</span>
                <span className="muted">
                  {e.query}
                  {e.affinity != null ? `, ${Math.round(e.affinity * 100)}% match` : ""}
                </span>
              </>
            )}
            {e.source === "web" && (
              <a href={e.url} target="_blank" rel="noopener noreferrer nofollow">
                {e.title} <span className="muted">({new URL(e.url).hostname})</span>
              </a>
            )}
            {e.source === "derived" && (
              <>
                <span>{e.label}</span>
                <span className="muted">{e.basis}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="muted small">Taste data from Qloo.</p>
    </details>
  );
}

export function DnaSection({ result }: { result: StepResult & { data: FansDnaOutput } }) {
  const { themes, candidates } = result.data;
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  return (
    <section className="section" aria-labelledby="dna-title">
      <h2 className="section-title" id="dna-title">
        Fan DNA
      </h2>
      <ul className="themes">
        {themes.map((t) => (
          <li key={t.name} className="lg theme">
            <div className="theme-head">
              <span className="theme-name">{t.name}</span>
              <span className="theme-strength">{Math.round(t.strength * 100)}</span>
            </div>
            <div className="meter" role="img" aria-label={`Strength ${Math.round(t.strength * 100)} out of 100`}>
              <span style={{ width: `${Math.max(4, t.strength * 100)}%` }} />
            </div>
            {t.description && <p className="theme-desc">{t.description}</p>}
            <p className="theme-src">
              From {t.sources.map((s) => byId.get(s)?.text).filter(Boolean).slice(0, 3).join(", ")}
            </p>
          </li>
        ))}
      </ul>
      <Notes notes={result.notes} />
      <Receipts evidence={result.evidence} />
    </section>
  );
}

export function DemographicsSection({ result }: { result: StepResult & { data: FansDemographicsOutput } }) {
  const d = result.data;
  if (!d.available) {
    return (
      <section className="section">
        <h2 className="section-title">Who the fans are</h2>
        <p className="muted">Age and gender data isn&rsquo;t available for this artist yet.</p>
      </section>
    );
  }
  const leanText =
    d.gender.lean === "balanced"
      ? "Evenly split between men and women."
      : d.gender.lean
        ? `${d.gender.strength === "slight" ? "Slightly" : d.gender.strength === "strong" ? "Strongly" : "Clearly"} more ${d.gender.lean === "male" ? "men" : "women"} than average.`
        : null;
  return (
    <section className="section" aria-labelledby="demo-title">
      <h2 className="section-title" id="demo-title">
        Who the fans are
      </h2>
      <p className="lead">
        {d.strongestAge ? `Strongest with ${d.strongestAge}. ` : ""}
        {leanText}
      </p>
      <div className="lg chart" role="img" aria-label="How much each age group over- or under-indexes for this fanbase">
        <div className="legend">
          <span>
            <i className="sw over" /> More than average
          </span>
          <span>
            <i className="sw under" /> Less than average
          </span>
        </div>
        <ul className="diverge">
          {d.ages.map((a) => {
            const pct = Math.min(100, Math.abs(a.index) * 100);
            return (
              <li key={a.band} title={`${a.label}: ${a.index > 0 ? "+" : ""}${a.index.toFixed(2)} affinity index`}>
                <span className="dv-label">{a.label}</span>
                <span className="dv-track">
                  <span className="dv-mid" aria-hidden="true" />
                  <span className={`dv-bar ${a.index >= 0 ? "over" : "under"}`} style={{ width: `${pct / 2}%` }} />
                </span>
                <span className="dv-value">
                  {a.index > 0 ? "+" : ""}
                  {a.index.toFixed(2)}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="muted small">Affinity index from −1 to +1, compared with the average audience. Not a headcount.</p>
      </div>
      <Receipts evidence={result.evidence} />
    </section>
  );
}

export function ProfileSection({ result, artistName }: { result: StepResult & { data: FansProfileOutput }; artistName: string }) {
  const categories = result.data.categories.filter((c) => c.items.length > 0);
  const [active, setActive] = useState(0);
  const cat = categories[Math.min(active, categories.length - 1)];
  if (!cat) return null;
  return (
    <section className="section" aria-labelledby="profile-title">
      <h2 className="section-title" id="profile-title">
        What {artistName}&rsquo;s fans love
      </h2>
      <div className="tabs" role="tablist" aria-label="Categories">
        {categories.map((c, i) => (
          <button key={c.key} role="tab" aria-selected={i === active} className="tab" onClick={() => setActive(i)}>
            {c.label}
          </button>
        ))}
      </div>
      <ol className="lg items" role="tabpanel">
        {cat.items.map((it) => {
          const pct = it.affinity != null ? Math.round(it.affinity * 100) : null;
          return (
            <li key={it.id} className="item" title={pct != null ? `${it.name}: ${pct}% match with this fanbase` : it.name}>
              {it.image ? <img className="thumb" src={it.image} alt="" width={44} height={44} loading="lazy" /> : <span className="thumb" />}
              <span className="item-name">{it.name}</span>
              {pct != null && (
                <>
                  <span className="item-meter" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="item-pct">{pct}%</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <Notes notes={result.notes} />
      <Receipts evidence={result.evidence.filter((e) => e.source !== "qloo" || cat.items.some((i) => i.id === e.entityId))} />
    </section>
  );
}
