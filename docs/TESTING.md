# Testing

## What's tested

Unit and integration tests run offline on synthetic data (Qloo's data may not be committed): `npm test` runs the engine (Vitest, `packages/engine/test`) and the web app (Vitest, `apps/web/test`). Counts are in the README.

| Area | How |
|---|---|
| The agent loop | Scripted policies drive `runAgent`: tool validation, repeated calls, budgets, self-checks sent back, a failing tool switched off, the last finishing turn, fallback to the autopilot |
| The trip agent | A stubbed model and stubbed map, Qloo and fare services run the real skill end to end; the model choosing `find_travel`, fixed steps reusing its answers |
| Model output | Every reply shape models write (actions, flat, `tool_calls`, namespaced names, refused tool calls recovered from a 400) |
| Money | Budgets computed in code, live fares charged and estimates never charged, fitting a budget, currency conversion |
| Safety | Grounding (no invented ids, prices, contacts), request parsing (dates, diet, stay style), sealed approvals |
| Web | Calendar feed, currency, route geometry for the 3D city |

## Live checks

`npm run check` verifies Qloo and the AI model with real keys. `npm run check:locations` measures venue coverage in 24 cities. Live runs against the deployed site, what was wrong and how it was fixed, are logged in [VERIFICATION.md](VERIFICATION.md); the QA checklist is in [QA.md](QA.md).

## Writing a test

- No network: stub clients (`test/helpers.ts`: `stubQloo`, `stubLlm`, `ctxWith`).
- No real Qloo responses in fixtures.
- When a live run finds a bug, add the case that reproduces it before fixing.

## Gates on every commit

A pre-commit hook (Husky + lint-staged) runs ESLint on the changed files, a secrets scan on everything staged, and the type check. CI repeats them on every push, then runs the unit tests and the design tests.

| Gate | What it catches | Where |
| --- | --- | --- |
| TypeScript strict | Nulls and wrong shapes | `npm run typecheck` |
| ESLint, type-aware | An unawaited tool call that would fail silently (`no-floating-promises`), a hook with a stale dependency, a control without a name, a price typed outside the money code | `npm run lint` |
| Secrets scan | A key pasted into a file | `npm run check:secrets` |
| Design tests (Playwright) | Overflow, clipped text, small tap targets, contrast, missing labels, a state with no words, a flow that breaks | `npm run e2e` in `apps/web` (`E2E_VISUAL=1` adds screenshot comparison; `E2E_LITE=1` skips the WebGL interactions on a machine with no GPU) |

The React Compiler rules (`react-hooks/refs`, `immutability`, `set-state-in-effect`, `purity`) report as warnings: the 3D map mutates refs on purpose, and they are reviewed rather than blocking until that code is reworked.

## Agent evals

`npm run evals -w @backline/engine` runs the 30-case corpus (`packages/engine/evals/corpus.json`: easy, underspecified, odd and hostile requests) through the real trip agent on a synthetic world, and the code judges in `evals/judges.ts` check the invariants: every place grounded in a tool result, travel checked when there is an origin, the limits held, the dates and budget respected, diets respected, hostile text in a page or a request ignored, no unsourced prices, an empty city reported honestly. Without keys it runs the autopilot (deterministic, in CI on every push). `EVAL_MODEL=1` runs the live model chain (nightly in `.github/workflows/evals.yml`) and writes the scorecard to `evals/out/last-run.json`. Every bug found in the agent adds its request to the corpus.

## Property tests

`packages/engine/test/properties/` states the money and parser laws and lets fast-check try hundreds of inputs each, shrinking a failure to its smallest case: estimates are whole, monotonic and never charged; a live fare always wins; fitting a budget never unticks a flight; the parser never throws and never invents a number, a date or a diet.

## Security checks

| Check | What it does | Where |
| --- | --- | --- |
| Dependency audit | Fails CI on a high or critical advisory in code that ships; dev-only tooling is reported; every accepted finding carries a reason and an expiry date | `node scripts/audit.mjs` |
| Hostile user, HTTP layer | Wrong methods, oversized and malformed bodies, injection strings, unauthenticated writes, path games against every API route: a 5xx or a leaked internal is a finding | `node scripts/abuse.mjs --base <url>` (CI runs it on the built app) |
| Hostile user and hostile world, agent layer | Requests that try to skip approval, spend, call or email strangers, or steer the model; services that return poisoned names, negative fares, HTML, 10,000 results or errors | `npm run evals -w @backline/engine` (`evals/adversarial.test.ts`) |
| DAST | HawkScan crawls the live site and probes it like an attacker, weekly | `.github/workflows/security-scan.yml` (needs `HAWK_API_KEY`) |
| Request bodies | Every JSON body is capped at 64 KB before parsing (`lib/body.ts`) | all API routes |

Found by these on their first run and fixed: a fare of zero or below from the provider would have been accepted as a live price; a forged Vapi webhook got a trip code back (now refused unless Vapi confirms the call).
