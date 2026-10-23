"use client";
// Passport for booking flights. Saved encrypted; afterwards only a masked summary is shown.
import { useEffect, useState } from "react";

type Summary = { name: string; numberEnding: string; nationality: string; issuingCountry: string; expiresOn: string; updatedAt: string };
type Form = { givenNames: string; familyName: string; number: string; nationality: string; issuingCountry: string; expiresOn: string; birthDate: string; gender: "" | "m" | "f" };

const EMPTY: Form = { givenNames: "", familyName: "", number: "", nationality: "NG", issuingCountry: "NG", expiresOn: "", birthDate: "", gender: "" };
const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function TravelDocuments() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<Summary | null>(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Form>(EMPTY);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/account/documents", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ready?: boolean; passport?: Summary | null }) => {
        setReady(Boolean(j.ready));
        setSaved(j.passport ?? null);
      })
      .catch(() => setReady(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.gender) return setError("Choose the gender shown on your passport.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/documents", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passport: f, consent }) });
    const j = (await res.json().catch(() => ({}))) as { passport?: Summary; error?: string };
    setBusy(false);
    if (!res.ok || !j.passport) return setError(j.error ?? "Your passport couldn't be saved.");
    setSaved(j.passport);
    setEditing(false);
    setF(EMPTY);
    setConsent(false);
  }

  async function remove() {
    setSaved(null);
    await fetch("/api/account/documents", { method: "DELETE" });
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <section className="lg account-card">
      <h2 className="account-h">Travel documents</h2>
      <p className="fine">Airlines need your passport to issue tickets. It&rsquo;s encrypted before it&rsquo;s stored, only ever shown masked, and only used to book your flights.</p>

      {ready === false && <p className="account-empty">Secure document storage isn&rsquo;t switched on yet.</p>}

      {ready && saved && !editing && (
        <div className="doc-card">
          <div>
            <p className="doc-name">{saved.name}</p>
            <p className="fine">
              Passport ending {saved.numberEnding} · {saved.issuingCountry} · expires {date(saved.expiresOn)}
            </p>
          </div>
          <div className="doc-acts">
            <button type="button" className="act" onClick={() => setEditing(true)}>
              Replace
            </button>
            <button type="button" className="link-btn" onClick={remove}>
              Remove
            </button>
          </div>
        </div>
      )}

      {ready && (!saved || editing) && (
        <form className="pref-grid" onSubmit={save} autoComplete="off">
          <label className="pref-field">
            <span>Given names (as on passport)</span>
            <input value={f.givenNames} onChange={set("givenNames")} required maxLength={60} />
          </label>
          <label className="pref-field">
            <span>Surname</span>
            <input value={f.familyName} onChange={set("familyName")} required maxLength={60} />
          </label>
          <label className="pref-field">
            <span>Passport number</span>
            <input value={f.number} onChange={set("number")} required maxLength={20} spellCheck={false} autoCapitalize="characters" />
          </label>
          <label className="pref-field">
            <span>Expiry date</span>
            <input type="date" value={f.expiresOn} onChange={set("expiresOn")} required />
          </label>
          <label className="pref-field">
            <span>Nationality (2 letters)</span>
            <input value={f.nationality} onChange={set("nationality")} required maxLength={2} autoCapitalize="characters" />
          </label>
          <label className="pref-field">
            <span>Issuing country (2 letters)</span>
            <input value={f.issuingCountry} onChange={set("issuingCountry")} required maxLength={2} autoCapitalize="characters" />
          </label>
          <label className="pref-field">
            <span>Date of birth</span>
            <input type="date" value={f.birthDate} onChange={set("birthDate")} required />
          </label>
          <label className="pref-field">
            <span>Gender (as on passport)</span>
            <select value={f.gender} onChange={set("gender")} required>
              <option value="">Choose</option>
              <option value="f">Female</option>
              <option value="m">Male</option>
            </select>
          </label>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I agree to Backline storing my passport encrypted and sharing it only with the airline when it books a flight for me. I can remove it any time.</span>
          </label>
          <div className="account-save">
            {error && <p className="join-error">{error}</p>}
            {editing && (
              <button type="button" className="link-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
            <button type="submit" className="go" disabled={busy || !consent}>
              {busy ? "Saving…" : "Save passport"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
