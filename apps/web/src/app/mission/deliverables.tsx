"use client";
// What a mission hands back: decisions to make, and finished work with one-click actions.
import { useState } from "react";
import type {
  BrandMatchesOutput,
  BrandPitchesOutput,
  BrandResearchOutput,
  ContentAdsOutput,
  ContentAnglesOutput,
  ContentMerchOutput,
  ContentReleaseOutput,
  GrowthCollaboratorsOutput,
  GrowthMarketsOutput,
  GrowthPressOutput,
  TourCitiesOutput,
  TourExperiencesOutput,
  TourRouteOutput,
  TourVenuesOutput,
  FansSegmentsOutput,
  CompareArtistsOutput,
  CompareBrandsOutput,
} from "@backline/engine";
import type { CheckpointRequest, StepResult } from "@/lib/mission-stream";
import { copyText, downloadFile, mailtoHref, slug, toCsv } from "@/lib/actions";
import { Notes, Receipts } from "./sections";

type R<T> = StepResult & { data: T };

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="act"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

// ---------- Checkpoint ----------

export function CheckpointPanel({ request, busy, onConfirm }: { request: CheckpointRequest; busy: boolean; onConfirm: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>(() => request.options.filter((o) => o.recommended).map((o) => o.id).slice(0, request.max));
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= request.max ? p : [...p, id]));
  const valid = picked.length >= request.min && picked.length <= request.max;
  return (
    <section className="lg checkpoint" aria-labelledby={`cp-${request.id}`}>
      <p className="eyebrow">Your call</p>
      <h2 id={`cp-${request.id}`} className="cp-title">
        {request.title}
      </h2>
      <p className="muted">{request.hint}</p>
      <ul className="cp-options">
        {request.options.map((o) => {
          const on = picked.includes(o.id);
          return (
            <li key={o.id}>
              <button type="button" className={`cp-option${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(o.id)}>
                {o.image ? <img src={o.image} alt="" width={40} height={40} className="cp-img" loading="lazy" /> : <span className="cp-img" />}
                <span className="cp-text">
                  <span className="cp-label">
                    {o.label}
                    {o.flag && <span className={`cp-flag${o.flag === "Already partnered" ? " warn" : ""}`}>{o.flag}</span>}
                  </span>
                  <span className="cp-detail">{o.detail}</span>
                </span>
                <span className="cp-check" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="cp-foot">
        <span className="muted small">
          {picked.length} of {request.max} picked
        </span>
        <button type="button" className="go" disabled={!valid || busy} onClick={() => onConfirm(picked)}>
          {busy ? "Working…" : "Go ahead"}
        </button>
      </div>
    </section>
  );
}

// ---------- Brand deal ----------

export function PitchesSection({ result, artistName, onOnePager }: { result: R<BrandPitchesOutput>; artistName: string; onOnePager: (brandId: string) => void }) {
  return (
    <section className="section" aria-labelledby="pitches-title">
      <h2 className="section-title" id="pitches-title">
        Pitches ready to send
      </h2>
      <p className="muted">Review, add your name, and send them from your own email. Nothing is sent for you.</p>
      <div className="pitches">
        {result.data.pitches.map((p) => {
          const email = `Subject: ${p.subject}\n\n${p.body}`;
          return (
            <article key={p.brandId} className="lg pitch">
              <header className="pitch-head">
                <h3 className="pitch-brand">{p.brandName}</h3>
                {p.method === "template" && <span className="tag">Template</span>}
              </header>
              <p className="pitch-subject">
                <span className="muted">Subject</span> {p.subject}
              </p>
              <div className="pitch-body">{p.body}</div>
              {p.contactRoute && (
                <p className="pitch-contact">
                  <span className="muted">Who to contact</span> {p.contactRoute}
                </p>
              )}
              <details className="pitch-facts">
                <summary>Why this pitch ({p.facts.length} facts)</summary>
                <ul>
                  {p.facts.map((f) => (
                    <li key={f.id}>{f.text}</li>
                  ))}
                </ul>
              </details>
              <div className="acts">
                <CopyButton text={email} label="Copy email" />
                <a className="act" href={mailtoHref(p.subject, p.body)}>
                  Open in email
                </a>
                <button type="button" className="act" onClick={() => onOnePager(p.brandId)}>
                  One-pager PDF
                </button>
                <button type="button" className="act" onClick={() => downloadFile(`${slug(artistName)}-${slug(p.brandName)}-pitch.md`, `# ${artistName} × ${p.brandName}\n\n**Subject:** ${p.subject}\n\n${p.body}\n\n## Based on\n${p.facts.map((f) => `- ${f.text}`).join("\n")}\n`)}>
                  Download
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <Notes notes={result.notes} />
      <Receipts evidence={result.evidence} />
    </section>
  );
}

export function OnePager({ pitch, artistName, matches }: { pitch: BrandPitchesOutput["pitches"][number]; artistName: string; matches?: BrandMatchesOutput }) {
  const m = matches?.matches.find((x) => x.id === pitch.brandId);
  return (
    <article className="onepager">
      <p className="op-eyebrow">Partnership proposal</p>
      <h1 className="op-title">
        {artistName} × {pitch.brandName}
      </h1>
      <p className="op-hook">{pitch.hook}</p>
      <h2>Why it fits</h2>
      <ul>
        {(m?.reasons ?? []).map((r) => (
          <li key={r}>{r}</li>
        ))}
        {pitch.facts
          .filter((f) => !(m?.reasons ?? []).includes(f.text))
          .slice(0, 5)
          .map((f) => (
            <li key={f.id}>{f.text}</li>
          ))}
      </ul>
      <h2>The proposal</h2>
      <div className="op-body">{pitch.body}</div>
      <h2>Next step</h2>
      <p>{pitch.ask}</p>
      <p className="op-foot">Audience insight from Qloo taste data.</p>
    </article>
  );
}

export function BrandMatchesSection({ result, research }: { result: R<BrandMatchesOutput>; research?: R<BrandResearchOutput> }) {
  const [open, setOpen] = useState<string | null>(null);
  const { matches } = result.data;
  if (matches.length === 0) return null;
  return (
    <section className="section" aria-labelledby="matches-title">
      <h2 className="section-title" id="matches-title">
        Brands the fans already love
      </h2>
      <ol className="lg items">
        {matches.map((m) => {
          const rb = research?.data.brands.find((b) => b.id === m.id);
          const isOpen = open === m.id;
          return (
            <li key={m.id} className="match">
              <button type="button" className="item match-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.id)}>
                {m.image ? <img className="thumb" src={m.image} alt="" width={44} height={44} loading="lazy" /> : <span className="thumb" />}
                <span className="item-name">
                  {m.name}
                  {m.alreadyPartnered && <span className="cp-flag warn">Already partnered</span>}
                </span>
                <span className="item-meter" aria-hidden="true">
                  <span style={{ width: `${Math.round(m.fit * 100)}%` }} />
                </span>
                <span className="item-pct">{Math.round(m.fit * 100)}</span>
              </button>
              {isOpen && (
                <div className="match-more">
                  <ul>
                    {m.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {rb && rb.findings.length > 0 && (
                    <>
                      <p className="muted small">Recent moves</p>
                      <ul>
                        {rb.findings.map((f) => (
                          <li key={f.url + f.text}>
                            {f.text}{" "}
                            <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" className="src">
                              {new URL(f.url).hostname.replace(/^www\./, "")}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="muted small">Fit score out of 100: taste match, music history, audience age and markets.</p>
      <Notes notes={[...(result.notes ?? []), ...(research?.notes ?? [])]} />
      <Receipts evidence={[...result.evidence, ...(research?.evidence ?? [])]} />
    </section>
  );
}

// ---------- Tour ----------

export function TourSection({
  artistName,
  route,
  venues,
  experiences,
}: {
  artistName: string;
  route?: R<TourRouteOutput>;
  venues?: R<TourVenuesOutput>;
  experiences?: R<TourExperiencesOutput>;
}) {
  const csv = () => {
    const rows: (string | number | null)[][] = [["Stop", "City", "Venue", "Address", "Km from previous"]];
    for (const l of route?.data.legs ?? []) {
      const vs = venues?.data.stops.find((s) => s.cityId === l.cityId)?.venues ?? [];
      if (vs.length === 0) rows.push([l.order, l.city, "", "", l.kmFromPrevious]);
      vs.forEach((v, i) => rows.push([i === 0 ? l.order : "", i === 0 ? l.city : "", v.name, v.address, i === 0 ? l.kmFromPrevious : ""]));
    }
    downloadFile(`${slug(artistName)}-tour.csv`, toCsv(rows), "text/csv;charset=utf-8");
  };
  return (
    <>
      {route && route.data.legs.length > 0 && (
        <section className="section" aria-labelledby="route-title">
          <div className="section-head">
            <h2 className="section-title" id="route-title">
              The route
            </h2>
            <button type="button" className="act" onClick={csv}>
              Download CSV
            </button>
          </div>
          <ol className="lg route">
            {route.data.legs.map((l) => {
              const vs = venues?.data.stops.find((s) => s.cityId === l.cityId);
              return (
                <li key={l.cityId} className="leg">
                  <span className="leg-n">{l.order}</span>
                  <div className="leg-body">
                    <p className="leg-city">
                      {l.city}
                      {l.kmFromPrevious ? <span className="muted small"> · {l.kmFromPrevious.toLocaleString("en")} km</span> : null}
                    </p>
                    {vs && vs.venues.length > 0 ? (
                      <ul className="venues">
                        {vs.venues.slice(0, 4).map((v) => (
                          <li key={v.id}>
                            <span>{v.name}</span>
                            {v.address && <span className="muted small"> · {v.address}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted small">No venue data for this city yet.</p>
                    )}
                    {vs && vs.coverage !== "exact" && vs.venues.length > 0 && <p className="muted small">Searched {vs.searched}.</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="muted small">About {route.data.totalKm.toLocaleString("en")} km in total, straight-line. Venues are music venues this fanbase over-indexes on.</p>
          <Notes notes={[...(route.notes ?? []), ...(venues?.notes ?? [])]} />
          <Receipts evidence={[...route.evidence, ...(venues?.evidence ?? [])]} />
        </section>
      )}
      {experiences && experiences.data.ideas.length > 0 && (
        <section className="section" aria-labelledby="exp-title">
          <h2 className="section-title" id="exp-title">
            Fan experiences
          </h2>
          <ul className="cards">
            {experiences.data.ideas.map((i) => (
              <li key={i.title} className="lg card">
                <p className="card-title">{i.title}</p>
                {i.city && <p className="card-meta">{i.city}</p>}
                <p className="card-text">{i.description}</p>
              </li>
            ))}
          </ul>
          <Receipts evidence={experiences.evidence} />
        </section>
      )}
    </>
  );
}

export function CitiesSection({ result }: { result: R<TourCitiesOutput> }) {
  return (
    <section className="section" aria-labelledby="cities-title">
      <h2 className="section-title" id="cities-title">
        Where the taste is strongest
      </h2>
      <ol className="lg items">
        {result.data.cities.map((c) => {
          const pct = c.affinity != null ? Math.round(c.affinity * 100) : null;
          return (
            <li key={c.id} className="item">
              {c.image ? <img className="thumb" src={c.image} alt="" width={44} height={44} loading="lazy" /> : <span className="thumb" />}
              <span className="item-name">{c.name}</span>
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
      <Receipts evidence={result.evidence} />
    </section>
  );
}

// ---------- Growth ----------

export function GrowthSection({ collabs, markets, press }: { collabs?: R<GrowthCollaboratorsOutput>; markets?: R<GrowthMarketsOutput>; press?: R<GrowthPressOutput> }) {
  const tierLabel = { reach: "Reach up", peer: "Peer", rising: "Rising" } as const;
  return (
    <>
      {collabs && collabs.data.collaborators.length > 0 && (
        <section className="section" aria-labelledby="collab-title">
          <h2 className="section-title" id="collab-title">
            Collaborators who share the fans
          </h2>
          <ul className="cards">
            {collabs.data.collaborators.map((c) => (
              <li key={c.id} className="lg card row">
                {c.image ? <img className="thumb" src={c.image} alt="" width={44} height={44} loading="lazy" /> : <span className="thumb" />}
                <div>
                  <p className="card-title">
                    {c.name} <span className={`tier ${c.tier}`}>{tierLabel[c.tier]}</span>
                  </p>
                  <p className="card-text">{c.reason}</p>
                </div>
              </li>
            ))}
          </ul>
          <Receipts evidence={collabs.evidence} />
        </section>
      )}
      {markets && markets.data.markets.length > 0 && (
        <section className="section" aria-labelledby="markets-title">
          <h2 className="section-title" id="markets-title">
            New markets
          </h2>
          <ul className="chips-list">
            {markets.data.markets.map((m) => (
              <li key={m.id} className="lg chip-item">
                {m.name}
                {m.affinity != null && <span className="muted small"> {Math.round(m.affinity * 100)}%</span>}
              </li>
            ))}
          </ul>
          <Notes notes={markets.notes} />
          <Receipts evidence={markets.evidence} />
        </section>
      )}
      {press && (press.data.podcasts.length > 0 || press.data.outlets.length > 0) && (
        <section className="section" aria-labelledby="press-title">
          <h2 className="section-title" id="press-title">
            Press and podcasts to pitch
          </h2>
          {press.data.podcasts.length > 0 && (
            <>
              <p className="sub">Podcasts the fans love</p>
              <ul className="chips-list">
                {press.data.podcasts.map((p) => (
                  <li key={p.id} className="lg chip-item">
                    {p.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          {press.data.outlets.length > 0 && (
            <>
              <p className="sub">Outlets covering artists who share the fans</p>
              <ul className="cards">
                {press.data.outlets.map((o) => (
                  <li key={o.domain} className="lg card">
                    <p className="card-title">{o.domain}</p>
                    <p className="card-meta">Covered {o.covered.join(", ")}</p>
                    <ul className="card-links">
                      {o.examples.map((e) => (
                        <li key={e.url}>
                          <a href={e.url} target="_blank" rel="noopener noreferrer nofollow">
                            {e.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Notes notes={press.notes} />
          <Receipts evidence={press.evidence} />
        </section>
      )}
    </>
  );
}

// ---------- Content ----------

export function ContentSection({ angles, ads, merch, release }: { angles?: R<ContentAnglesOutput>; ads?: R<ContentAdsOutput>; merch?: R<ContentMerchOutput>; release?: R<ContentReleaseOutput> }) {
  return (
    <>
      {angles && angles.data.angles.length > 0 && (
        <section className="section" aria-labelledby="angles-title">
          <h2 className="section-title" id="angles-title">
            Content angles
          </h2>
          <ul className="cards">
            {angles.data.angles.map((a) => (
              <li key={a.title} className="lg card">
                <p className="card-meta">{a.format}</p>
                <p className="card-title">{a.title}</p>
                <p className="card-hook">“{a.hook}”</p>
                <p className="card-text">{a.why}</p>
                <div className="acts">
                  <CopyButton text={`${a.title}\nHook: ${a.hook}\n${a.why}`} />
                </div>
              </li>
            ))}
          </ul>
          <Receipts evidence={angles.evidence} />
        </section>
      )}
      {ads && (
        <section className="section" aria-labelledby="ads-title">
          <div className="section-head">
            <h2 className="section-title" id="ads-title">
              Ad targeting brief
            </h2>
            <CopyButton
              label="Copy brief"
              text={[ads.data.summary, ads.data.ages.length ? `Ages: ${ads.data.ages.map((a) => a.label).join(", ")}` : "", ads.data.gender ? `Gender: ${ads.data.gender}` : "", ...ads.data.interests.map((i) => `${i.group}: ${i.names.join(", ")}`), ads.data.locations.length ? `Locations: ${ads.data.locations.join(", ")}` : "", ads.data.keywords.length ? `Keywords: ${ads.data.keywords.join(", ")}` : ""].filter(Boolean).join("\n")}
            />
          </div>
          <div className="lg brief-card">
            <p className="lead">{ads.data.summary}</p>
            <dl className="kv">
              {ads.data.ages.length > 0 && (
                <>
                  <dt>Ages</dt>
                  <dd>{ads.data.ages.map((a) => a.label).join(", ")}</dd>
                </>
              )}
              {ads.data.gender && (
                <>
                  <dt>Gender</dt>
                  <dd>{ads.data.gender}</dd>
                </>
              )}
              {ads.data.interests.map((i) => (
                <div key={i.group} className="kv-row">
                  <dt>{i.group}</dt>
                  <dd>{i.names.join(", ")}</dd>
                </div>
              ))}
              {ads.data.locations.length > 0 && (
                <>
                  <dt>Locations</dt>
                  <dd>{ads.data.locations.join(", ")}</dd>
                </>
              )}
              {ads.data.keywords.length > 0 && (
                <>
                  <dt>Keywords</dt>
                  <dd>{ads.data.keywords.join(", ")}</dd>
                </>
              )}
            </dl>
          </div>
          <Notes notes={ads.notes} />
        </section>
      )}
      {release && release.data.weeks.length > 0 && (
        <section className="section" aria-labelledby="release-title">
          <h2 className="section-title" id="release-title">
            {release.data.title}
          </h2>
          <ol className="lg weeks">
            {release.data.weeks.map((w) => (
              <li key={w.label} className="week">
                <p className="week-label">{w.label}</p>
                <div>
                  <p className="week-focus">{w.focus}</p>
                  <ul>
                    {w.actions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
          <Receipts evidence={release.evidence} />
        </section>
      )}
      {merch && merch.data.ideas.length > 0 && (
        <section className="section" aria-labelledby="merch-title">
          <h2 className="section-title" id="merch-title">
            Merch direction
          </h2>
          <ul className="cards">
            {merch.data.ideas.map((m) => (
              <li key={m.item + m.concept} className="lg card">
                <p className="card-meta">{m.item}</p>
                <p className="card-title">{m.concept}</p>
                <p className="card-text">{m.why}</p>
              </li>
            ))}
          </ul>
          <Receipts evidence={merch.evidence} />
        </section>
      )}
    </>
  );
}

// ---------- Compare and segments ----------

export function SegmentsSection({ result }: { result: R<FansSegmentsOutput> }) {
  const segs = result.data.segments.filter((s) => s.brands.length + s.artists.length > 0);
  if (segs.length === 0) return null;
  return (
    <section className="section" aria-labelledby="seg-title">
      <h2 className="section-title" id="seg-title">
        Fan segments
      </h2>
      <ul className="cards">
        {segs.map((s) => (
          <li key={s.band} className="lg card">
            <p className="card-meta">Ages {s.label}</p>
            {s.unique.length > 0 && <p className="card-title">Into {s.unique.slice(0, 3).join(", ")}</p>}
            {s.artists.length > 0 && <p className="card-text">Artists: {s.artists.map((a) => a.name).join(", ")}</p>}
            {s.brands.length > 0 && <p className="card-text">Brands: {s.brands.map((b) => b.name).join(", ")}</p>}
          </li>
        ))}
      </ul>
      <p className="muted small">Each card shows what fans in that age group love; the headline is what sets them apart from the other segments.</p>
      <Notes notes={result.notes} />
      <Receipts evidence={result.evidence} />
    </section>
  );
}

export function CompareArtistsSection({ result, artistName }: { result: R<CompareArtistsOutput>; artistName: string }) {
  const d = result.data;
  if (!d.applicable || !d.rival) return null;
  return (
    <section className="section" aria-labelledby="cmp-title">
      <h2 className="section-title" id="cmp-title">
        {artistName} vs {d.rival.name}
      </h2>
      {d.takeaways.length > 0 && (
        <ul className="lg takeaways">
          {d.takeaways.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <div className="versus">
        <div className="lg card">
          <p className="card-meta">Only {artistName}&rsquo;s fans</p>
          <p className="card-text">{d.onlyArtist.join(", ") || "Nothing distinct"}</p>
        </div>
        <div className="lg card">
          <p className="card-meta">Both</p>
          <p className="card-text">{d.shared.join(", ") || "No overlap in the top lists"}</p>
        </div>
        <div className="lg card">
          <p className="card-meta">Only {d.rival.name}&rsquo;s fans</p>
          <p className="card-text">{d.onlyRival.join(", ") || "Nothing distinct"}</p>
        </div>
      </div>
      {d.ages.some((a) => a.artist != null || a.rival != null) && (
        <div className="lg chart">
          <div className="legend">
            <span>
              <i className="sw over" /> {artistName}
            </span>
            <span>
              <i className="sw rival" /> {d.rival.name}
            </span>
          </div>
          <ul className="pairs">
            {d.ages.map((a) => (
              <li key={a.label}>
                <span className="dv-label">{a.label}</span>
                <span className="pair-bars">
                  <PairBar v={a.artist} cls="over" />
                  <PairBar v={a.rival} cls="rival" />
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">Affinity index from −1 to +1 per age group. Bars right of centre mean more than average.</p>
        </div>
      )}
      <Receipts evidence={result.evidence} />
    </section>
  );
}

function PairBar({ v, cls }: { v: number | null; cls: string }) {
  if (v == null) return <span className="dv-track" />;
  const pct = Math.min(100, Math.abs(v) * 100) / 2;
  return (
    <span className="dv-track" title={`${v > 0 ? "+" : ""}${v.toFixed(2)}`}>
      <span className="dv-mid" aria-hidden="true" />
      <span className={`dv-bar ${cls} ${v >= 0 ? "pos" : "neg"}`} style={{ width: `${pct}%`, ...(v >= 0 ? { left: "50%" } : { right: "50%" }) }} />
    </span>
  );
}

export function CompareBrandsSection({ result }: { result: R<CompareBrandsOutput> }) {
  const d = result.data;
  if (!d.applicable) return null;
  return (
    <section className="section" aria-labelledby="h2h-title">
      <h2 className="section-title" id="h2h-title">
        Head-to-head
      </h2>
      <p className="lead">{d.verdict}</p>
      <div className="versus">
        {d.brands.map((b) => (
          <div key={b.query} className={`lg card${d.winner === b.name ? " winner" : ""}`}>
            {d.winner === b.name && <p className="card-meta">Stronger fit</p>}
            <p className="card-title">{b.name}</p>
            <p className="card-text">{b.rank ? `#${b.rank} among the fans' favourite brands` : "Not in the fans' top 50 brands"}</p>
            <p className="card-text">{b.audienceMatch != null ? `Audience age match ${Math.round(b.audienceMatch * 100)}%` : "No audience data"}</p>
          </div>
        ))}
      </div>
      <Notes notes={result.notes} />
      <Receipts evidence={result.evidence} />
    </section>
  );
}
