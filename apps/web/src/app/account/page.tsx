import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "../Logo";
import { BRAND } from "@/lib/brand";
import { getSession } from "@/lib/session";
import AccountView from "./AccountView";
import BackToTrip from "../BackToTrip";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  // Only checks they're signed in; the account API refreshes tokens, since a page can't save new cookies.
  const s = await getSession({ refresh: false });
  if (!s && !(await cookies()).has("bl_rt")) redirect("/signin?next=/account");
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
