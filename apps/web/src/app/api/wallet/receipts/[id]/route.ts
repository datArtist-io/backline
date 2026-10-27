// One payment receipt from the signed-in person's wallet (row-level security keeps it theirs).
import { getSession } from "@/lib/session";
import { rest } from "@/lib/supabase";
import { loadAccount } from "@/lib/account";
import { localCurrency, perUsd, type WalletEntry } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession().catch(() => null);
  if (!s) return Response.json({ error: "Sign in to see your receipts." }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Unknown receipt." }, { status: 400 });
  const rows = await rest<WalletEntry[]>(s.cfg, s.accessToken, `wallet_entries?select=id,kind,status,amount_minor,original_amount,original_currency,label,ref,details,created_at&id=eq.${id}&kind=eq.payment`).catch(() => []);
  const e = rows[0];
  if (!e) return Response.json({ error: "Receipt not found." }, { status: 404 });
  const profile = await loadAccount(s).then((a) => a.profile).catch(() => ({ currency: undefined, name: undefined }));
  const wanted = localCurrency(profile.currency, req.headers.get("x-vercel-ip-country"));
  const per = await perUsd(wanted);
  const currency = per ? wanted : "USD";
  return Response.json(
    { entry: e, payer: { name: profile.name ?? s.user.name, email: s.user.email }, local: { currency, amount: Math.round((e.amount_minor / 100) * (per ?? 1) * 100) / 100 } },
    { headers: { "Cache-Control": "no-store" } }
  );
}
