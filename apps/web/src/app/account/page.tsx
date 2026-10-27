import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";
import { getSession } from "@/lib/session";
import AccountView from "./AccountView";
import BackToTrip from "../BackToTrip";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const s = await getSession();
  if (!s) redirect("/signin?next=/account");
  return (
    <>
      <header className="nav">
        <Link href="/" className="wordmark" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
        <div className="nav-acts">
          <BackToTrip />
          <Link href="/" className="lg pill">
            New trip
          </Link>
        </div>
      </header>
      <main className="account">
        <AccountView />
      </main>
    </>
  );
}
