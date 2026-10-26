import type { Metadata } from "next";
import Link from "next/link";
import GlassFilter from "../GlassFilter";
import MissionView from "./MissionView";

export const metadata: Metadata = { title: "Mission", robots: { index: false } };

const MISSIONS = ["plan", "brand_deal", "tour", "grow", "content", "compare", "brief"] as const;
type M = (typeof MISSIONS)[number];

export default async function MissionPage({ searchParams }: { searchParams: Promise<{ goal?: string; artist?: string; m?: string; mode?: string; docs?: string; debug?: string }> }) {
  const sp = await searchParams;
  const goal = sp.goal?.trim().slice(0, 2000) || undefined;
  const artist = sp.artist?.trim().slice(0, 120) || undefined;
  const mission = (MISSIONS as readonly string[]).includes(sp.m ?? "") ? (sp.m as M) : undefined;
  // Default: the agent runs end to end. "Check with me" is opt-in.
  const autonomy = sp.mode === "check" ? "check" : "auto";
  // Attached files are kept in this tab; the URL only carries a short key to find them.
  const docs = sp.docs && /^[a-z0-9]{4,32}$/.test(sp.docs) ? sp.docs : undefined;

  if (!goal && !artist && !docs) {
    return (
      <main className="holding">
        <GlassFilter />
        <div className="lg holding-card">
          <h1>Give the agent a goal</h1>
          <p>For example: &ldquo;Plan a birthday weekend in Lisbon for 6, €3,000 budget&rdquo; or &ldquo;Book dinner for 4 in Mexico City on Friday&rdquo;.</p>
          <Link href="/" className="lg pill">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      <GlassFilter />
      <MissionView key={`${goal}|${artist}|${mission}|${autonomy}|${docs}`} goal={goal} artist={artist} mission={mission} autonomy={autonomy} docs={docs} debug={sp.debug === "1"} />
    </>
  );
}
