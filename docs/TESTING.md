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
