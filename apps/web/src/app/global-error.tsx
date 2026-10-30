"use client";
// Last resort when the root layout itself fails: a plain page with a way back.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "grid", placeItems: "center", margin: 0, background: "#f6f6fb", color: "#10132b" }}>
        <div style={{ textAlign: "center", display: "grid", gap: 12, padding: 24 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Backline hit a problem</h1>
          <p style={{ margin: 0 }}>Reload the page or try again.</p>
          <div>
            <button type="button" onClick={reset} style={{ padding: "10px 18px", borderRadius: 999, border: 0, background: "#10132b", color: "#fff", cursor: "pointer" }}>Try again</button>
          </div>
        </div>
      </body>
    </html>
  );
}
