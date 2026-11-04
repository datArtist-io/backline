# 0001. A ReAct agent at the core, not a fixed pipeline

**Status:** Accepted, November 2026

## Context
Trips differ: one needs a landmark pinned, another a whole home, another a fare weighed against a tight budget, another a concert. A fixed sequence of steps does the same work every time and can't react to what it finds.

## Decision
Research and choosing is one agent loop (`packages/engine/src/agent/runtime.ts`). Each turn the model reasons in one sentence, calls up to three tools in parallel, reads the results, and decides the next step until it finishes. Tools: `update_trip`, `locate`, `search_places`, `check_places`, `find_travel`, `find_events`, `research`, `read_document`. The steps after it (plan, routes, payment slip) reuse what it found through a per-run shared lookup.

Guards: tool names and arguments validated; repeated calls answered from memory; budgets (10 turns, 24 calls, 90 s) with a last finish-only turn; a tool failing twice in a row switched off; a finish checked and sent back once (missing picks, over budget, fares not checked); an autopilot that finishes with the same tools if the model fails three times in a row.

## Consequences
Runs vary with the model, so quality depends on the model; the trace shows every decision so this is visible. It works with any chat model that returns JSON, without native function calling, and recovers native tool calls a provider refuses.
