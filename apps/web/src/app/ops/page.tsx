import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { opsSession } from "@/lib/ops";
import OpsView from "./OpsView";

// Private: only accounts in ADMIN_EMAILS. Anyone else (signed out included) sees a plain 404.
export const metadata: Metadata = { title: "Ops", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const s = await opsSession();
  if (!s) notFound();
  return <OpsView email={s.user.email ?? ""} />;
}
