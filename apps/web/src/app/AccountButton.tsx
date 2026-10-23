"use client";
// Top-right account control: "Sign in" when signed out, the person's initial when signed in.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/lib/auth-client";

export default function AccountButton() {
  const { me, ready, configured } = useMe();
  const path = usePathname();
  if (!ready || !configured) return null;
  if (!me)
    return (
      <Link href={`/signin?next=${encodeURIComponent(path || "/")}`} className="lg pill">
        Sign in
      </Link>
    );
  const label = me.name || (me.lens ? `@${me.lens}` : null) || me.email || (me.wallet ? `${me.wallet.slice(0, 6)}…${me.wallet.slice(-4)}` : null) || "Account";
  return (
    <Link href="/account" className="lg pill account-pill" aria-label={`Your account (${label})`} title={label}>
      {me.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={me.avatar} alt="" width={24} height={24} referrerPolicy="no-referrer" />
      ) : (
        <span className="account-initial" aria-hidden="true">
          {label.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="account-label">Account</span>
    </Link>
  );
}
