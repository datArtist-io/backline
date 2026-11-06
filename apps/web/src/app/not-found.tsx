// A wrong link lands somewhere that looks like Backline, with a way back, instead of a bare 404.
import Link from "next/link";

export const metadata = { title: "Page not found · Backline" };

export default function NotFound() {
  return (
    <main style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ maxWidth: 420, display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>This page doesn&rsquo;t exist</h1>
        <p style={{ margin: 0, opacity: 0.75 }}>The link may be old or mistyped. Say where you want to go and Backline does the rest.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/" className="rerun">Plan a trip</Link>
        </div>
      </div>
    </main>
  );
}
