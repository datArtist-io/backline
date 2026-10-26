// Free research with no key (Wikivoyage, Wikipedia) and the provider chain. Synthetic responses.
import { describe, expect, it, vi } from "vitest";
import { WikiSearchClient, bestPassage, keywords } from "../src/clients/wiki";
import { ChainedWebSearch } from "../src/clients/chain";
import { UpstreamError } from "../src/errors";
import type { WebSearch } from "../src/clients/web";

const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "Content-Type": "application/json" } });

describe("free research", () => {
  it("turns a question into keywords and finds the passage that answers it", () => {
    expect(keywords("Which train station in Lagos serves intercity passenger trains?")).toBe("train station Lagos serves intercity passenger trains");
    const page = "Lagos is the largest city in Nigeria.\n\n== Get in ==\nBy train: the Lagos–Ibadan railway arrives at Mobolaji Johnson Station in Ebute Metta, with trains several times a day.\n\nBy plane: Murtala Muhammed International Airport is in Ikeja.";
    expect(bestPassage(page, "Which train station do intercity trains arrive at in Lagos?")).toContain("Mobolaji Johnson Station");
  });

  it("searches Wikivoyage and Wikipedia without a key and reads the best page", async () => {
    const fetch = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.searchParams.get("list") === "search") return json({ query: { search: [{ title: "Lagos", snippet: 'the <span class="searchmatch">train</span> station' }, { title: "Ebute Metta", snippet: "a district" }] } });
      return json({ query: { pages: [{ extract: "Get in\nBy train: trains from Ibadan arrive at Mobolaji Johnson Station, Ebute Metta, several times daily." }] } });
    });
    const wiki = new WikiSearchClient({ fetch: fetch as unknown as typeof globalThis.fetch, userAgent: "test" });
    const out = await wiki.search("Which train station do trains from Ibadan arrive at in Lagos?");
    expect(out[0]).toMatchObject({ title: "Lagos (Wikivoyage)", url: "https://en.wikivoyage.org/wiki/Lagos" });
    expect(out[0].content).toContain("Mobolaji Johnson Station");
    expect(out.some((r) => r.url.startsWith("https://en.wikipedia.org/"))).toBe(true);
    expect(String(fetch.mock.calls[0][0])).toContain("srsearch=train+station+trains+Ibadan+arrive+Lagos");
  });

  it("hands over from a provider that's out of quota or finds nothing, and rests it", async () => {
    const quota: WebSearch = { provider: "claude", search: vi.fn(async () => { throw new UpstreamError("web", 429, "quota"); }) };
    const empty: WebSearch = { provider: "tavily", search: vi.fn(async () => []) };
    const free: WebSearch = { provider: "wiki", search: vi.fn(async () => [{ title: "Lagos", url: "https://en.wikivoyage.org/wiki/Lagos", content: "By train…", publishedDate: null }]) };
    const chain = new ChainedWebSearch([quota, empty, free]);
    expect((await chain.search("q"))[0].title).toBe("Lagos");
    await chain.search("q2");
    expect(quota.search).toHaveBeenCalledTimes(1);
    expect(empty.search).toHaveBeenCalledTimes(2);
  });
});

import { ClaudeSearchClient, claudeResults } from "../src/clients/claude-search";

describe("Claude web search", () => {
  const answer = {
    content: [
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "lagos intercity train station" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://nrc.example/lagos", title: "Lagos–Ibadan service", page_age: "2026-09-01" }, { type: "web_search_result", url: "https://other.example", title: "Unused" }] },
      { type: "text", text: "Trains from Ibadan arrive at Mobolaji Johnson Station in Ebute Metta.", citations: [{ type: "web_search_result_location", url: "https://nrc.example/lagos", title: "Lagos–Ibadan service", cited_text: "terminates at Mobolaji Johnson Station" }] },
    ],
  };

  it("turns a cited answer into source-linked results", () => {
    const out = claudeResults(answer.content as never, 5);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: "https://nrc.example/lagos", publishedDate: "2026-09-01" });
    expect(out[0].content).toContain("Mobolaji Johnson Station in Ebute Metta");
  });

  it("calls the Messages API with the web search tool, and treats no credit as unavailable", async () => {
    const orig = globalThis.fetch;
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return seen.length === 1 ? json(answer) : new Response(JSON.stringify({ error: { message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400 });
    }) as typeof fetch;
    try {
      const c = new ClaudeSearchClient({ apiKey: "k" });
      expect((await c.search("Which station?"))[0].url).toBe("https://nrc.example/lagos");
      expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
      expect(seen[0].headers["anthropic-version"]).toBe("2023-06-01");
      expect(seen[0].body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
      const err = await c.search("Another?").then(() => null, (e: unknown) => e as { status: number; userMessage: string });
      expect(err?.status).toBe(403);
      expect(err?.userMessage).toBe("The Claude API account is out of credit.");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
