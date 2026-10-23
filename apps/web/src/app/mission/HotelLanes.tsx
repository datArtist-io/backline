"use client";
// Hotels in lanes: premium, closest, best value and lowest price. One colour per lane so searches
// are easy to tell apart. The top hotel in a lane gets a large card; the next two sit beside it.
// Prices are shown only as listed online for the trip's dates, linked to the page they're on.
import { useState } from "react";
import type { HotelScore, HotelTier, Place, TierId } from "@backline/engine";
import { TasteMatch } from "./Taste";

export const LANE_COLOR: Record<TierId, string> = { premium: "#8b5cf6", closest: "#f97316", value: "#10b981", cheapest: "#3b82f6" };
const LANE_ICON: Record<TierId, string> = { premium: "★", closest: "◎", value: "◆", cheapest: "↓" };

const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString("en")} ${currency}`;
  }
};

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PHONE = "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z";
const GLOBE = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z";
const PIN = "M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Zm0-9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z";

export default function HotelLanes({
  tiers,
  places,
  chosenId,
  bookingUrl,
}: {
  tiers: HotelTier[];
  scores?: HotelScore[];
  places: Map<string, Place>;
  chosenId?: string | null;
  /** A link to check one hotel's availability for the trip's dates. */
  bookingUrl: (p: Place) => string;
}) {
  const [lane, setLane] = useState<TierId>(tiers[0]?.id ?? "premium");
  const current = tiers.find((t) => t.id === lane) ?? tiers[0];
  if (!current) return null;

  return (
    <section className="section lanes" aria-labelledby="lanes-title" style={{ ["--lane" as string]: LANE_COLOR[current.id] }}>
      <div className="lanes-head">
        <h2 className="section-title" id="lanes-title">
          Where you&rsquo;ll stay
        </h2>
        <div className="lane-tabs" role="tablist" aria-label="Sort hotels by">
          {tiers.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === current.id} className={`lane-tab${t.id === current.id ? " on" : ""}`} style={{ ["--c" as string]: LANE_COLOR[t.id] }} onClick={() => setLane(t.id)}>
              <span className="lane-dot" aria-hidden="true">
                {LANE_ICON[t.id]}
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="lane-blurb" key={`b-${current.id}`}>
        {current.blurb}
      </p>

      <ol className="lane-grid" key={current.id}>
        {current.picks.map((pk, i) => {
          const p = places.get(pk.id);
          if (!p) return null;
          const price = pk.price;
          return (
            <li key={pk.id} className={`lane-card${i === 0 ? " lead" : ""}`} style={{ ["--i" as string]: i }}>
              <div className="lane-top">
                <span className="lane-rank">{i === 0 ? current.label : `#${i + 1}`}</span>
                {chosenId === pk.id && <span className="lane-pick">My pick</span>}
              </div>
              <p className="lane-name">{p.name}</p>
              <TasteMatch match={p.match} compact />
              <p className="lane-meta">
                {p.rating != null && <span className="lane-star">★ {p.rating.toFixed(1)}</span>}
                {p.distanceKm != null && <span>{p.distanceKm < 1 ? `${Math.round(p.distanceKm * 1000)} m` : `${p.distanceKm} km`} away</span>}
              </p>
              <div className="lane-price">
                {price ? (
                  <>
                    <p>
                      <strong>{money(price.perNight, price.currency)}</strong> <span>/ night</span>
                    </p>
                    <p className="lane-price-sub">
                      {price.total != null && <>{money(price.total, price.currency)} total · </>}
                      {price.url ? (
                        <a href={price.url} target="_blank" rel="noopener noreferrer nofollow">
                          {price.basis === "live" ? "live rate" : `on ${price.site ?? "the web"}`}
                        </a>
                      ) : (
                        "quoted online"
                      )}
                    </p>
                  </>
                ) : (
                  <p className="lane-price-none">No price listed for your dates</p>
                )}
              </div>
              <div className="lane-acts">
                <a className="lane-book" href={bookingUrl(p)} target="_blank" rel="noopener noreferrer">
                  Check dates
                </a>
                {p.phone && (
                  <a className="lane-ico" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${p.name}`} title={p.phone}>
                    <Icon d={PHONE} />
                  </a>
                )}
                {p.website && (
                  <a className="lane-ico" href={p.website} target="_blank" rel="noopener noreferrer nofollow" aria-label={`${p.name} website`} title="Website">
                    <Icon d={GLOBE} />
                  </a>
                )}
                {p.lat != null && p.lon != null && (
                  <a className="lane-ico" href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`} target="_blank" rel="noopener noreferrer" aria-label={`${p.name} on the map`} title="Map">
                    <Icon d={PIN} />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
