// Demo calling: booking calls ring the signed-in person's own phone, within a daily allowance.

/** Country dial codes for numbers typed without "+", from the connection's country. */
export const DIAL: Record<string, string> = { NG: "234", GH: "233", KE: "254", ZA: "27", US: "1", CA: "1", GB: "44", IE: "353", AE: "971", FR: "33", DE: "49", ES: "34", IT: "39", PT: "351", NL: "31", IN: "91", JP: "81", AU: "61", BR: "55", MX: "52" };

/** Demo calls per person per day (per server instance): enough to show it works, not enough to misuse. */
const demoCalls = new Map<string, { day: string; n: number }>();
export function underDailyCap(userId: string, cap = 12): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const e = demoCalls.get(userId);
  const n = e && e.day === day ? e.n : 0;
  if (n >= cap) return false;
  demoCalls.set(userId, { day, n: n + 1 });
  return true;
}
