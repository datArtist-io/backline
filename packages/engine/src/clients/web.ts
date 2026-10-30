// Web research is one tool the agent uses, behind one small interface, so the provider
// (Claude web search, Tavily, or free Wikivoyage/Wikipedia) is a configuration choice.
export type WebResult = { title: string; url: string; content: string; publishedDate: string | null };

/** What one call to an outside service did, for diagnostics. Content is never recorded. */
export type ProviderCall = { at: number; purpose: string; model: string; ms: number; ok: boolean; status: number | null; error: string | null };

/** "booking" lookups want prices and contacts (live web only); "facts" can come from reference sites. */
export type SearchOptions = {
  maxResults?: number;
  days?: number;
  signal?: AbortSignal;
  need?: "facts" | "booking";
  /** Read the pages themselves, up to this many characters each (providers that can; others ignore it). */
  pageChars?: number;
};

export interface WebSearch {
  readonly provider: string;
  search(query: string, opts?: SearchOptions): Promise<WebResult[]>;
  /** Recent calls since a time, newest last (optional; for diagnostics). */
  recentCalls?(sinceMs?: number): ProviderCall[];
}
