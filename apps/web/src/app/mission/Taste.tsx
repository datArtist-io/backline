"use client";
// The person's taste as Qloo reads it, shown before the plan: who and what it's read from, the
// vibe, scenes and dishes that go with it, who shares it, what those fans also love and the part
// of town where it's strongest. Every pick below is searched and scored with this taste.
import type { TasteOutput } from "@backline/engine";

const FROM_LABEL: Record<string, string> = { star: "Planning like", request: "You love", saved: "Saved" };
const PRICE = ["", "$", "$$", "$$$", "$$$$"];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function Avatar({ name, image, size = 44 }: { name: string; image?: string | null; size?: number }) {
  return image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="taste-avatar" src={image} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
  ) : (
    <span className="taste-avatar is-initials" style={{ width: size, height: size }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** A small symbol for a taste that's a genre or cuisine rather than a name. Pure. */
const tagIcon = (id: string) => (/:music/.test(id) ? "♪" : /:place|dish/.test(id) ? "🍴" : /:media|movie|tv/.test(id) ? "▶" : "✦");

/** "Planned like Radiohead", "Tuned to Bad Bunny and jazz". Pure. */
export function tasteHeadline(t: Pick<TasteOutput, "signals" | "tags">): string {
  const star = t.signals.find((s) => s.from === "star");
  if (star) return `Planned like ${star.name}`;
  const names = [...t.signals.map((s) => s.name), ...t.tags.map((x) => x.name)].slice(0, 3);
  if (names.length === 0) return "";
  return `Tuned to ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`}`;
}

function Chips({ items, tone }: { items: string[]; tone: string }) {
  return (
    <ul className={`taste-chips tone-${tone}`}>
      {items.map((x, i) => (
        <li key={x} style={{ ["--i" as string]: i }}>
          {x}
        </li>
      ))}
    </ul>
  );
}

export default function TasteCard({ taste, onEdit, onShowMap }: { taste: TasteOutput; onEdit: () => void; onShowMap?: () => void }) {
  const tags = taste.tags ?? [];
  const has = taste.signals.length + tags.length > 0;
  if (!has) {
    return (
      <section className="section" aria-label="Your taste">
        <div className="lg taste-card is-empty">
          <span className="taste-kicker">Taste by Qloo</span>
          <p className="taste-empty">Tell me what you love (an artist, a film, a cuisine) or who you&rsquo;d like to plan it like, and every pick gets tuned to your taste.</p>
          <button type="button" className="taste-edit" onClick={onEdit}>
            Add what you love
          </button>
        </div>
      </section>
    );
  }
  const facts = [
    taste.audience ? { label: "Shared most by", value: `People ${taste.audience}` } : null,
    taste.priceLean ? { label: "Spends like", value: PRICE[taste.priceLean] } : null,
  ].filter((x): x is { label: string; value: string } => x !== null);
  return (
    <section className="section" aria-labelledby="taste-title">
      <div className="lg taste-card">
        <div className="taste-head">
          <div>
            <span className="taste-kicker">Your taste, read by Qloo</span>
            <h2 className="taste-title" id="taste-title">
              {tasteHeadline({ signals: taste.signals, tags })}
            </h2>
          </div>
          <button type="button" className="taste-edit" onClick={onEdit}>
            Change
          </button>
        </div>

        <ul className="taste-signals">
          {taste.signals.map((s, i) => (
            <li key={s.id} style={{ ["--i" as string]: i }}>
              <Avatar name={s.name} image={s.image} />
              <span>
                <span className="taste-sub">{FROM_LABEL[s.from ?? "request"]}</span>
                <span className="taste-name">{s.name}</span>
              </span>
            </li>
          ))}
          {tags.map((t, i) => (
            <li key={t.id} style={{ ["--i" as string]: taste.signals.length + i }}>
              <span className="taste-avatar is-tag" aria-hidden="true">
                {tagIcon(t.id)}
              </span>
              <span>
                <span className="taste-sub">You love</span>
                <span className="taste-name">{t.name}</span>
              </span>
            </li>
          ))}
        </ul>

        {(taste.vibes.length > 0 || taste.scenes.length > 0 || taste.dishes.length > 0 || facts.length > 0) && (
          <div className="taste-grid">
            {taste.vibes.length > 0 && (
              <div className="taste-block">
                <p className="taste-label">The vibe</p>
                <Chips items={taste.vibes} tone="vibe" />
              </div>
            )}
            {taste.scenes.length > 0 && (
              <div className="taste-block">
                <p className="taste-label">Where this taste goes</p>
                <Chips items={taste.scenes} tone="scene" />
              </div>
            )}
            {taste.dishes.length > 0 && (
              <div className="taste-block">
                <p className="taste-label">What it orders</p>
                <Chips items={taste.dishes} tone="dish" />
              </div>
            )}
            {facts.map((f) => (
              <div key={f.label} className="taste-block">
                <p className="taste-label">{f.label}</p>
                <p className="taste-fact">{f.value}</p>
              </div>
            ))}
          </div>
        )}

        {taste.zone && (
          <button type="button" className="taste-zone" onClick={onShowMap} disabled={!onShowMap}>
            <span className="taste-zone-pin" aria-hidden="true" />
            <span>
              Your taste is strongest around <strong>{taste.zone.name ?? "one part of town"}</strong>. Without a set venue, that&rsquo;s where I search first.
            </span>
            {onShowMap && <span className="taste-zone-cta">See the heatmap</span>}
          </button>
        )}

        {taste.alsoLoved.length > 0 && (
          <div className="taste-also">
            <p className="taste-label">Fans of this taste also love</p>
            <ul>
              {taste.alsoLoved.map((x) => (
                <li key={x.id} title={x.name}>
                  <Avatar name={x.name} image={x.image} size={34} />
                  <span>{x.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

const MATCH_WORD = (m: number) => (m >= 0.9 ? "Top taste match" : m >= 0.75 ? "Strong taste match" : m >= 0.6 ? "Good taste match" : "Fits your taste");

/** A small ring showing how well a place fits the person's taste (Qloo affinity, ranked). */
export function TasteMatch({ match, compact = false }: { match: number | null | undefined; compact?: boolean }) {
  if (match == null) return null;
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span className={`taste-match${compact ? " is-compact" : ""}`} title={`${MATCH_WORD(match)} (from Qloo)`}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
        <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${(c * match).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 9 9)" />
      </svg>
      {MATCH_WORD(match)}
    </span>
  );
}
