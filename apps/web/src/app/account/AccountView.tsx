"use client";
// Everything the agent keeps for a signed-in person: their details, what it remembers about them
// and the trips it booked. Each can be changed or removed here.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Profile } from "@backline/engine";
import type { Memory, SavedTrip, Search } from "@/lib/account";
import type { Me } from "@/lib/auth-client";
import { saveDetails, signOut } from "@/lib/auth-client";
import TravelDocuments from "./TravelDocuments";
import Verify from "../mission/Verify";
import WalletPanel from "../mission/Wallet";
import { toYou } from "@backline/engine/you";

type Account = { user: Me; profile: Profile; memories: Memory[]; trips: SavedTrip[]; searches: Search[] };

const KIND: Record<Memory["kind"], string> = { like: "Loves", stayed: "Stayed at", visited: "Went to", note: "Note" };
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const dateRange = (a: string | null, b: string | null) => {
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (a && b) return `${f(a)} to ${f(b)}`;
  return a ? f(a) : null;
};

export default function AccountView() {
  const router = useRouter();
  const [acc, setAcc] = useState<Account | null>(null);
  const [p, setP] = useState<Profile>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("trips");
  // ?tab=wallet (from a receipt) opens that tab.
  useEffect(() => {
    const t = TABS.find((x) => x.id === new URLSearchParams(window.location.search).get("tab"));
    if (t) setTab(t.id);
  }, []);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/account", { cache: "no-store" });
    if (res.status === 401) return router.replace("/signin?next=/account");
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error ?? "Your account couldn't load.");
    setAcc(j as Account);
    setP((j as Account).profile ?? {});
  }, [router]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    const ok = await saveDetails(p, true);
    setSaving(false);
    if (ok) setSaved(true);
    else setError("Your details couldn't be saved. Try again.");
  }

  async function forget(id: string) {
    setAcc((a) => (a ? { ...a, memories: a.memories.filter((m) => m.id !== id) } : a));
    await fetch(`/api/account/memories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function removeTrip(id: string) {
    setAcc((a) => (a ? { ...a, trips: a.trips.filter((t) => t.id !== id) } : a));
    await fetch(`/api/account/trips?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function forgetSearch(id: string | "all") {
    setAcc((a) => (a ? { ...a, searches: id === "all" ? [] : a.searches.filter((x) => x.id !== id) } : a));
    await fetch(`/api/account/searches?${id === "all" ? "all=1" : `id=${encodeURIComponent(id)}`}`, { method: "DELETE" });
  }

  const rerun = (q: Search) => router.push(`/mission?${new URLSearchParams({ goal: q.query, mode: q.mode ?? "auto" })}`);
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  async function out() {
    await signOut();
    router.replace("/");
    router.refresh();
  }

  if (error && !acc)
    return (
      <p className="join-error" role="alert">
        {error}
      </p>
    );
  if (!acc) return <p className="account-wait">Loading your account…</p>;

  const field = (key: keyof Profile, label: string, opts: { placeholder?: string; type?: string; auto?: string } = {}) => (
    <label className="pref-field">
      <span>{label}</span>
      <input
        type={opts.type ?? "text"}
        autoComplete={opts.auto}
        value={(p[key] as string) ?? ""}
        placeholder={opts.placeholder}
        onChange={(e) => {
          setSaved(false);
          setP({ ...p, [key]: e.target.value || undefined });
        }}
        maxLength={key === "notes" ? 600 : 120}
      />
    </label>
  );
  const listField = (key: "likes" | "dietary" | "stayPrefs" | "loyalty" | "accessibility", label: string, placeholder: string) => (
    <label className="pref-field">
      <span>{label}</span>
      <input
        value={(p[key] ?? []).join(", ")}
        placeholder={placeholder}
        onChange={(e) => {
          setSaved(false);
          setP({ ...p, [key]: list(e.target.value) });
        }}
      />
    </label>
  );

  // Same request asked again, or the same trip saved again: show it once (newest first).
  const searches = (acc.searches ?? []).filter((q, i, all) => all.findIndex((x) => x.query.trim().toLowerCase() === q.query.trim().toLowerCase()) === i);
  const trips = acc.trips.filter((t, i, all) => all.findIndex((x) => x.title === t.title && x.start_date === t.start_date && x.end_date === t.end_date) === i);
  const shownSearches = showAll ? searches : searches.slice(0, 5);
  const shownTrips = showAll ? trips : trips.slice(0, 5);

  return (
    <div className="account-grid">
      <section className="lg account-card account-me">
        <div className="account-who">
          {acc.user.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={acc.user.avatar} alt="" width={48} height={48} referrerPolicy="no-referrer" />
          ) : (
            <span className="account-initial big" aria-hidden="true">
              {(acc.user.name || acc.user.email || "?").charAt(0).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="account-name">{acc.user.name || p.name || "Your account"}</h1>
            <p className="fine">
              {acc.user.email}
              {acc.user.provider && acc.user.provider !== "email" ? ` · signed in with ${acc.user.provider === "google" ? "Google" : acc.user.provider}` : ""}
            </p>
          </div>
        </div>
        <button type="button" className="act" onClick={out}>
          Sign out
        </button>
      </section>

      <nav className="account-tabs" role="tablist" aria-label="Your account">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => { setTab(t.id); setShowAll(false); }}>
            {t.label}
            {t.id === "trips" && trips.length > 0 && <em>{trips.length}</em>}
          </button>
        ))}
      </nav>

      {tab === "details" && <section className="lg account-card account-pane">
        <h2 className="account-h">Your details</h2>
        <p className="fine">Used to book flights and rooms in your name. Only you can see them.</p>
        <form className="acc-form" onSubmit={save}>
          <details className="acc-group" open>
            <summary><b>Legal name and contact</b><small>Exactly as on your passport</small></summary>
            <div className="pref-grid">
              {field("firstName", "First name", { auto: "given-name" })}
              {field("middleName", "Middle name(s)", { auto: "additional-name", placeholder: "Optional" })}
              {field("lastName", "Last name", { auto: "family-name" })}
              {field("name", "Name on bookings", { auto: "name", placeholder: "How places should greet you" })}
              {field("email", "Email for bookings", { type: "email", auto: "email" })}
              {field("phone", "Phone (for booking calls)", { type: "tel", auto: "tel", placeholder: "+234 811 000 0000" })}
            </div>
          </details>
          <details className="acc-group">
            <summary><b>Personal details</b><small>Airlines need these for every ticket</small></summary>
            <div className="pref-grid">
              {field("birthDate", "Date of birth", { type: "date", auto: "bday" })}
              <label className="pref-field">
                <span>Gender (as on your passport)</span>
                <select value={p.gender ?? ""} onChange={(e) => setP({ ...p, gender: (e.target.value || undefined) as Profile["gender"] })}>
                  <option value="">Prefer not to say</option>
                  <option value="f">Female</option>
                  <option value="m">Male</option>
                </select>
              </label>
              {field("nationality", "Nationality", { placeholder: "Nigerian" })}
              {field("residence", "Country you live in", { auto: "country-name" })}
              {field("language", "Preferred language", { placeholder: "English" })}
            </div>
          </details>
          <details className="acc-group">
            <summary><b>Home address</b><small>For hotel registration and receipts</small></summary>
            <div className="pref-grid">
              {field("addressLine", "Street address", { auto: "street-address" })}
              {field("addressCity", "City", { auto: "address-level2" })}
              {field("homeCity", "Home city for trips", { placeholder: "Where trips start" })}
              {field("addressPostcode", "Postcode", { auto: "postal-code" })}
              {field("addressCountry", "Country", { auto: "country-name" })}
            </div>
          </details>
          <details className="acc-group">
            <summary><b>Emergency contact</b><small>Shared only with a booking that asks for it</small></summary>
            <div className="pref-grid">
              {field("emergencyName", "Name")}
              {field("emergencyRelation", "Relationship", { placeholder: "Sister, partner…" })}
              {field("emergencyPhone", "Phone", { type: "tel" })}
            </div>
          </details>
          <details className="acc-group">
            <summary><b>Travel preferences</b><small>Seats, meals, loyalty and access needs</small></summary>
            <div className="pref-grid">
              <label className="pref-field">
                <span>Seat</span>
                <select value={p.seat ?? ""} onChange={(e) => setP({ ...p, seat: (e.target.value || undefined) as Profile["seat"] })}>
                  <option value="">No preference</option>
                  <option value="window">Window</option>
                  <option value="aisle">Aisle</option>
                </select>
              </label>
              {field("meal", "In-flight meal", { placeholder: "Vegetarian, halal…" })}
              {field("currency", "Currency", { placeholder: "USD, EUR, NGN…" })}
              {listField("loyalty", "Loyalty programmes", "Emirates Skywards 123456789")}
              {listField("accessibility", "Accessibility needs", "Wheelchair at the airport, step-free room")}
              {listField("dietary", "Dietary needs", "Vegetarian, no pork")}
              {listField("stayPrefs", "Hotel preferences", "Quiet room, pool")}
            </div>
          </details>
          <details className="acc-group">
            <summary><b>Taste</b><small>What Qloo uses to plan for you</small></summary>
            <div className="pref-grid">
              {listField("likes", "Things you love", "Radiohead, Fleabag, Japanese food")}
              {field("notes", "Anything else", { placeholder: "Travels with a toddler…" })}
            </div>
          </details>
          <div className="account-save">
            {error && <p className="join-error">{error}</p>}
            {saved && <p className="fine">Saved.</p>}
            <button type="submit" className="go" disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </button>
          </div>
        </form>
      </section>}

      {tab === "wallet" && (
        <div className="account-pane account-stack">
          <section className="lg account-card account-wallet" aria-label="Wallet"><WalletPanel /></section>
          <section className="lg account-card" aria-labelledby="id-h">
            <h2 className="account-h" id="id-h">Identity verification</h2>
            <p className="fine">Verified with Persona: a photo of your passport or national ID and a quick selfie. Flights and hotels that need ID only book for a verified traveller.</p>
            <Verify always />
          </section>
          <details className="lg account-card acc-group acc-docs">
            <summary><b>Passport for bookings</b><small>Stored encrypted, used only to issue tickets</small></summary>
            <TravelDocuments />
          </details>
        </div>
      )}

      {tab === "prefs" && <section className="lg account-card account-pane">
        <h2 className="account-h">Your preferences</h2>
        <p className="fine">Things you&rsquo;ve asked for, used to plan better trips. Remove anything you don&rsquo;t want used.</p>
        {acc.memories.length === 0 ? (
          <p className="account-empty">Nothing yet. Book a trip and it starts learning what you like.</p>
        ) : (
          <ul className="memory-list">
            {acc.memories.map((m) => (
              <li key={m.id} className="memory">
                <span className="memory-kind">{KIND[m.kind]}</span>
                <span className="memory-value">{m.value}</span>
                <button type="button" className="memory-x" onClick={() => forget(m.id)} aria-label={`Forget ${m.value}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>}

      {tab === "history" && <section className="lg account-card account-pane">
        <div className="account-h-row">
          <h2 className="account-h">Search history</h2>
          {(acc.searches ?? []).length > 0 && (
            <button type="button" className="link-btn" onClick={() => forgetSearch("all")}>
              Clear all
            </button>
          )}
        </div>
        <p className="fine">Everything you&rsquo;ve asked it, newest first. Tap one to run it again.</p>
        {searches.length === 0 ? (
          <p className="account-empty">Nothing yet. Your searches will show up here.</p>
        ) : (
          <ul className="search-list">
            {shownSearches.map((q) => (
              <li key={q.id} className="search-row">
                <button type="button" className="search-run" onClick={() => rerun(q)} title="Run this again">
                  <span className="search-q">{q.query}</span>
                  <span className="fine">{[q.destination, when(q.created_at)].filter(Boolean).join(" · ")}</span>
                </button>
                <button type="button" className="memory-x" onClick={() => forgetSearch(q.id)} aria-label={`Remove “${q.query}” from history`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {!showAll && searches.length > 5 && <button type="button" className="account-more" onClick={() => setShowAll(true)}>Show all {searches.length}</button>}
      </section>}

      {tab === "trips" && <section className="lg account-card account-pane">
        <h2 className="account-h">Your trips</h2>
        {trips.length === 0 ? (
          <p className="account-empty">No trips yet. Say where you&rsquo;re going and it books the rest.</p>
        ) : (
          <ul className="trip-list">
            {shownTrips.map((t) => (
              <li key={t.id} className="saved-trip">
                <button type="button" className="saved-trip-head" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                  <span className="saved-trip-title">{t.title}</span>
                  <span className="fine">{[t.destination, dateRange(t.start_date, t.end_date)].filter(Boolean).join(" · ")}</span>
                </button>
                {open === t.id && (
                  <div className="saved-trip-body">
                    {t.summary && <p>{toYou(t.summary)}</p>}
                    {t.details.bookings.length > 0 && (
                      <ul className="saved-bookings">
                        {t.details.bookings.map((b, i) => (
                          <li key={i}>
                            <strong>{b.title || "Booking"}</strong> <span className={`status status-${b.status}`}>{b.status}</span>
                            {b.ref && <span className="fine"> · ref {b.ref}</span>}
                            <div className="fine">{b.message}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.details.days.length > 0 && (
                      <ol className="saved-days">
                        {t.details.days.map((d, i) => (
                          <li key={i}>
                            <strong>{d.label}</strong>
                            {d.items.length > 0 && <span className="fine"> · {d.items.map((x) => x.title).join(", ")}</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="saved-trip-acts">
                      {t.goal && (
                        <button type="button" className="lg pill" onClick={() => router.push(`/mission?${new URLSearchParams({ goal: t.goal ?? "", mode: "check" })}`)} title="Plans it again and checks with you before anything is booked or paid">
                          Plan it again
                        </button>
                      )}
                      <button type="button" className="link-btn" onClick={() => removeTrip(t.id)}>
                        Remove this trip
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!showAll && trips.length > 5 && <button type="button" className="account-more" onClick={() => setShowAll(true)}>Show all {trips.length}</button>}
      </section>}
    </div>
  );
}

const TABS = [
  { id: "trips", label: "Trips" },
  { id: "wallet", label: "Wallet & ID" },
  { id: "details", label: "Details" },
  { id: "prefs", label: "Preferences" },
  { id: "history", label: "History" },
] as const;
