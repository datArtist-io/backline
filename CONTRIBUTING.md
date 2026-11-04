# Contributing

Thanks for helping. Backline is maintained by Josiah ([@datArtist-io](https://github.com/datArtist-io)).

## Setup

```bash
npm install
cp .env.example apps/web/.env.local   # fill in at least QLOO_API_KEY and one LLM_* provider
npm run dev                           # http://localhost:3000
```

Details: [README](README.md#getting-started), [deployment](docs/DEPLOYMENT.md), [architecture](docs/ARCHITECTURE.md).

## Making a change

1. Open an issue first for anything larger than a fix, so we agree on the approach.
2. Branch from `main`. Keep the change focused.
3. Before you push: `npm run typecheck` and `npm test` (CI runs both).
4. Add a test for every bug fixed and every behaviour added. Tests use synthetic data only: never commit Qloo responses, keys or personal data.
5. Update the docs the change touches: `docs/CHANGELOG.md` always; the README's test counts and environment table; `SECURITY.md`, `docs/INTEGRATIONS.md` and the privacy notice when you add an outside service.
6. Open a pull request using the template.

## Standards

- **TypeScript, strict.** Validate every input and every model output with Zod.
- **Never invent.** Places, prices, contacts and availability come from a tool or provider, or are labelled estimates. Prices are computed in code ([ADR 0002](docs/adr/0002-prices-in-code.md)).
- **Agent tools** are small, validated, time-limited, and say in their observation what the model needs to decide next ([ADR 0001](docs/adr/0001-react-agent-core.md)).
- **UI** is clean and compact: say it in fewer words, show it in less space.
- **Writing** in the product is plain, short and specific.
- **Security:** keys stay on the server; new API routes are rate limited and same-origin; follow the checklist in [SECURITY.md](SECURITY.md).

## Commits

Short imperative subject ("Recover refused tool calls"), with a body saying why when it isn't obvious.

## Reporting a security issue

Don't open a public issue: see [SECURITY.md](SECURITY.md).

By contributing you agree your work is licensed under the [MIT License](LICENSE) and that you'll follow the [code of conduct](CODE_OF_CONDUCT.md).
