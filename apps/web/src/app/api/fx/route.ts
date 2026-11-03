// Today's exchange rates (units per US dollar), so prices can be shown in the traveller's currency.
import { usdRates } from "@/lib/wallet";

export const runtime = "nodejs";

export async function GET() {
  const rates = await usdRates();
  if (!rates) return Response.json({ rates: { USD: 1 } }, { status: 503 });
  return Response.json({ rates }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=21600" } });
}
