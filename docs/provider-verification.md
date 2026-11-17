# Free AI provider verification

Date: 2026-11-17. Current feature status: **Testing — Z.ai account key pending**.

PADI uses free models for the current development stage. Z.ai replaces Mistral
in the reasoning role, using **GLM-4.7-Flash**, API ID `glm-4.7-flash`.

The PostgreSQL quota system is [Verified](postgresql-quota-verification.md).
Three providers have returned real PADI replies, and the primary-to-backup
fallback check passed. All four providers cannot be marked Verified until
Z.ai returns a real response with the user's account. Voice conversations,
persistent memory, and reminder delivery remain Planned under the agreed
feature-by-feature process.

## Live results

The latest run used the existing Go adapters, shared PADI instructions, model
registry, and real PostgreSQL usage ledger. Each request used the normal
1,024-token output allowance and requested a short PADI greeting.

| Provider / role | Selected API model | Result | Free-access evidence |
| --- | --- | --- | --- |
| Gemini / primary | `gemini-3.1-flash-lite` | Real reply; 234 input and 27 output tokens | User confirmed free account; Google lists free text input/output |
| Groq / fast | `openai/gpt-oss-20b` | Real reply; 300 input and 42 output tokens | User confirmed free account access |
| Z.ai / reasoning | `glm-4.7-flash` | Adapter tests passed; live reply pending `ZAI_API_KEY` | Official pricing lists input, cache, storage, and output as Free |
| OpenRouter / backup | `nvidia/nemotron-3.5-lightning:free` | Real reply; 250 input and 298 output tokens | Fresh public catalogue confirmed every published price field was zero |

The fallback check injected a controlled failure of the configured Gemini
primary. PADI's router then obtained a real OpenRouter reply:
“Hello! I'm PADI, your AI companion. How can I help you today?”
This verifies the routing path after an injected failure; no vendor outage
was observed or claimed.

The initial Gemini `gemini-2.5-flash-lite` request returned HTTP 404 despite
being listed in the catalogue. It was replaced with the current free model
above. OpenRouter's initial free Gemma selection returned HTTP 429. The
selected free Nemotron model first returned no visible reply at a 256-token
ceiling, then succeeded with the normal 1,024-token allowance. Reasoning
tokens can consume an output budget before visible text is produced.

The private machine-local report is:
`/tmp/my-padi-quota-verification/provider-live-verification.json`.
The first attempt is retained as `provider-live-first-attempt.json` in the
same directory. These reports contain test replies and metadata, never keys.
Both have owner-only permissions. The latest pending results are only the
missing Z.ai key and the associated unconfigured reasoning model.

## Configuration and rerunning

The private environment file is `backend/.env`, excluded from Git and mode
`0600`. Existing Gemini, Groq, and OpenRouter keys were preserved. A distinct
empty `ZAI_API_KEY` slot was added. Z.ai is not enabled in the private model
registry until its key is supplied; the other three tested selections are
configured. The committed `.env.example` contains empty keys and a commented
four-provider configuration with the selected free model IDs.

Keep keys in the backend environment file. Add the Z.ai account key there,
then enable the `zai-reasoning` entry and matching free-model identity from
the example. Runtime Z.ai configuration accepts only `glm-4.7-flash`; the
other Z.ai model variants are outside the current free-model plan.

For accounts whose free access has been confirmed, use the matching entries
in `PADI_AI_FREE_ACCOUNT_CONFIRMED` and exact identities in
`PADI_AI_APPROVED_FREE_MODELS`. The verifier sends requests only for confirmed,
approved models. OpenRouter additionally requires zero published catalogue
prices; Z.ai requires its exact model to remain Free on the official pricing
page. Public catalogue/documentation access does not authenticate an account.
Z.ai account availability is verified only by a successful live generation.

From `backend/`, check catalogues and Z.ai's published pricing without
generating replies:

```sh
go run ./cmd/verifyproviders --env-file .env --catalog-only --output provider-catalogs.json
```

Run live replies and the controlled fallback check:

```sh
go run ./cmd/verifyproviders --env-file .env --output provider-verification.json
```

The verifier reads `.env` as data without executing shell expressions or
overwriting existing environment variables. Authentication keys stay in
headers and are never sent to public documentation. Reports omit upstream
error bodies and hidden reasoning. Unapproved, unavailable, or unconfirmed
models are blocked from generation, including through fallback. A missing
fourth account does not prevent checks of the other configured accounts.

Use a migrated `DATABASE_URL`, or set a disposable `PADI_TEST_DATABASE_URL`
when the application database URL is empty. The latter keeps verification
requests and usage records in the test database; it does not configure the
application server's database.

Exit code 0 means the requested checks passed; 2 means required configuration
or verification remains pending; 1 means the command could not run or save
its report. `go run` reports the program's exit code 2 as `exit status 2` with
a shell exit code of 1. Local adapter tests alone do not complete live provider
verification. Future pricing and account quota changes still need review.

## Validation and sources

The full backend suite passed with real PostgreSQL and the Go race detector
after the Z.ai replacement. Focused verifier race tests passed after adjusting
the output allowance. `go vet ./...` and `git diff --check` passed.

Tests cover Z.ai authentication, conversation context, thinking controls,
structured JSON, hidden-reasoning exclusion, rejection of unselected Z.ai
models, literal environment parsing, catalogue pagination/capabilities,
exact decimal prices, structured pricing overrides, and paid/unconfirmed
fallback exclusion. Quota tests also passed with all four selected provider
names in their isolation checks.

- [Google Gemini pricing](https://aistudio.google.com/docs/pricing)
- [Groq account limits](https://console.groq.com/docs/rate-limits)
- [Z.ai model pricing](https://docs.z.ai/guides/overview/pricing)
- [Z.ai chat API](https://docs.z.ai/api-reference/llm/chat-completion)
- [Z.ai thinking controls](https://docs.z.ai/guides/capabilities/thinking-mode)
- [OpenRouter live model catalogue](https://openrouter.ai/api/v1/models)
