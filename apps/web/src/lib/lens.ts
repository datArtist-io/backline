// Lens Protocol accounts a wallet owns or manages, read from the public Lens API.
// Used for "Continue with Lens": the wallet signs in, and the Lens account becomes the profile.

const LENS_API = "https://api.lens.xyz/graphql";

export type LensAccount = { address: string; handle: string; name: string | null; picture: string | null; owned: boolean };

const QUERY = `query Available($wallet: EvmAddress!) {
  accountsAvailable(request: { managedBy: $wallet, includeOwned: true, pageSize: TEN }) {
    items {
      __typename
      ... on AccountOwned { account { address username { localName } metadata { name picture } } }
      ... on AccountManaged { account { address username { localName } metadata { name picture } } }
    }
  }
}`;

type Item = { __typename: string; account?: { address: string; username: { localName: string } | null; metadata: { name: string | null; picture: string | null } | null } };

/** Lens accounts with a username for this wallet, owned ones first. */
export async function lensAccountsFor(wallet: string): Promise<LensAccount[]> {
  const res = await fetch(LENS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { wallet } }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Lens API ${res.status}`);
  const j = (await res.json()) as { data?: { accountsAvailable?: { items?: Item[] } }; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return (j.data?.accountsAvailable?.items ?? [])
    .filter((i) => i.account?.username?.localName)
    .map((i) => ({
      address: i.account!.address,
      handle: i.account!.username!.localName,
      name: i.account!.metadata?.name || null,
      picture: safeUrl(i.account!.metadata?.picture),
      owned: i.__typename === "AccountOwned",
    }))
    .sort((a, b) => Number(b.owned) - Number(a.owned));
}

/** Only https pictures (IPFS gateways included); lens:// and ipfs:// URIs are turned into gateway links. */
function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith("ipfs://")) return `https://gw.ipfs-lens.dev/ipfs/${u.slice(7)}`;
  return /^https:\/\//.test(u) ? u : null;
}
