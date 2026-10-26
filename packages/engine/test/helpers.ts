// Test helpers. All data here is synthetic: no real Qloo responses may be committed (SECURITY.md).
import { vi } from "vitest";
import type { QlooClient, QlooEntity } from "../src/clients/qloo";
import type { LlmClient } from "../src/clients/llm";
import { createUsageMeter } from "../src/context";
import type { SkillContext } from "../src/types";

export function entity(p: Partial<QlooEntity> & { id: string; name: string }): QlooEntity {
  return {
    type: "urn:entity:artist",
    affinity: null,
    popularity: null,
    image: null,
    location: null,
    tags: [],
    properties: {},
    ...p,
  };
}

export function stubQloo(overrides: Partial<Record<keyof QlooClient, unknown>> = {}): QlooClient {
  return {
    search: vi.fn(async () => []),
    insights: vi.fn(async () => []),
    tagInsights: vi.fn(async () => []),
    demographics: vi.fn(async () => []),
    heatmap: vi.fn(async () => []),
    findTags: vi.fn(async () => []),
    ...overrides,
  } as unknown as QlooClient;
}

export function stubLlm(json: (req: unknown) => unknown): LlmClient {
  return { json: vi.fn(async (req: unknown) => json(req)) } as unknown as LlmClient;
}

export function ctxWith(parts: { qloo?: QlooClient; llm?: LlmClient | null } = {}): SkillContext {
  return {
    qloo: parts.qloo ?? stubQloo(),
    llm: parts.llm ?? null,
    web: null,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    usage: createUsageMeter(),
  };
}

export const ARTIST = entity({ id: "A-0", name: "Test Artist", popularity: 0.9 });
