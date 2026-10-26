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
  const listField = (key: "likes" | "dietary" | "stayPrefs", label: string, placeholder: string) => (
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

      <section className="lg account-card">
        <h2 className="account-h">Your details</h2>
        <p className="fine">Used to book flights and rooms in your name. Only you can see them.</p>
        <form className="pref-grid" onSubmit={save}>
          {field("name", "Full name (as on your passport)", { auto: "name" })}
          {field("email", "Email for bookings", { type: "email", auto: "email" })}
          {field("phone", "Phone", { type: "tel", auto: "tel", placeholder: "+234…" })}
          {field("homeCity", "Home city", { placeholder: "Lagos" })}
          {field("birthDate", "Date of birth", { type: "date", auto: "bday" })}
          <label className="pref-field">
            <span>Gender (for airline records)</span>
            <select value={p.gender ?? ""} onChange={(e) => setP({ ...p, gender: (e.target.value || undefined) as Profile["gender"] })}>
              <option value="">Prefer not to say</option>
              <option value="f">Female</option>
              <option value="m">Male</option>
            </select>
          </label>
          {field("currency", "Currency", { placeholder: "NGN" })}
          {listField("likes", "Things you love", "Burna Boy, Insecure, Japanese food")}
          {listField("dietary", "Dietary needs", "Vegetarian, no pork")}
          {listField("stayPrefs", "Hotel preferences", "Quiet room, pool")}
          {field("notes", "Anything else", { placeholder: "Travels with a toddler…" })}
          <div className="account-save">
            {error && <p className="join-error">{error}</p>}
            {saved && <p className="fine">Saved.</p>}
            <button type="submit" className="go" disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </button>
          </div>
        </form>
      </section>

      <TravelDocuments />

      <section className="lg account-card">
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
      </section>

      <section className="lg account-card">
        <div className="account-h-row">
          <h2 className="account-h">Search history</h2>
          {(acc.searches ?? []).length > 0 && (
            <button type="button" className="link-btn" onClick={() => forgetSearch("all")}>
              Clear all
            </button>
          )}
        </div>
        <p className="fine">Everything you&rsquo;ve asked it, newest first. Tap one to run it again.</p>
        {(acc.searches ?? []).length === 0 ? (
          <p className="account-empty">Nothing yet. Your searches will show up here.</p>
        ) : (
          <ul className="search-list">
            {acc.searches.map((q) => (
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
      </section>

      <section className="lg account-card">
        <h2 className="account-h">Your trips</h2>
        {acc.trips.length === 0 ? (
          <p className="account-empty">No trips yet. Say where you&rsquo;re going and it books the rest.</p>
        ) : (
          <ul className="trip-list">
            {acc.trips.map((t) => (
              <li key={t.id} className="saved-trip">
                <button type="button" className="saved-trip-head" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                  <span className="saved-trip-title">{t.title}</span>
                  <span className="fine">{[t.destination, dateRange(t.start_date, t.end_date)].filter(Boolean).join(" · ")}</span>
                </button>
                {open === t.id && (
                  <div className="saved-trip-body">
                    {t.summary && <p>{t.summary}</p>}
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
                    <button type="button" className="link-btn" onClick={() => removeTrip(t.id)}>
                      Remove this trip
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
