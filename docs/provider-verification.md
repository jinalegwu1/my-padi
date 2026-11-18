# Free AI provider verification

Date: 2026-11-18. Current feature status: **Verified — four live greetings and controlled fallback**.

PADI uses free models for the current development stage. Z.ai replaces Mistral
in the reasoning role, using **GLM-4.7-Flash**, API ID `glm-4.7-flash`.

The PostgreSQL quota system is [Verified](postgresql-quota-verification.md).
All four providers returned real PADI greetings with the configured accounts,
and the primary-to-backup fallback check passed. Z.ai's separate live reasoning
check remains **Testing** after follow-up requests returned HTTP 429; reasoning
quality is not marked Verified. Voice conversations,
persistent memory, and reminder delivery remain Planned under the agreed
feature-by-feature process.

## Live results

The latest run used the existing Go adapters, shared PADI instructions, model
registry, and real PostgreSQL usage ledger. Each request used the normal
1,024-token output allowance and requested a short PADI greeting.

| Provider / role | Selected API model | Result | Free-access evidence |
| --- | --- | --- | --- |
| Gemini / primary | `gemini-3.1-flash-lite` | Real greeting; 234 input and 19 output tokens | User confirmed free account; Google lists free text input/output |
| Groq / fast | `openai/gpt-oss-20b` | Real greeting; 300 input and 40 output tokens | User confirmed free account access |
| Z.ai / reasoning | `glm-4.7-flash` | Real greeting; 236 input and 28 output tokens | User confirmed free access; fresh official pricing check confirmed Free |
| OpenRouter / backup | `nvidia/nemotron-3.5-lightning:free` | Real greeting; 250 input and 288 output tokens | Fresh public catalogue confirmed every published price field was zero |

Z.ai returned: “Hello! I am PADI, your consistent AI companion. It's a pleasure
to meet you. How can I support you today?” This greeting used thinking disabled.
Follow-up reasoning checks used thinking enabled, but were rate-limited. The
reasoning model's configured timeout is now 60 seconds, with no automatic retry.
Mobile chat sends the conversation task. Go also infers complexity from message
length and keywords such as “step by step”, “compare”, and “analyze”; complex
messages can therefore use Z.ai even without an explicit reasoning task label.
This is a basic heuristic, not a production model-based classification service.

Provider replies with no visible text now trigger immediate fallback. Contract
tests cover Z.ai returning only hidden reasoning, skipping retries against that
model, obtaining a primary reply, and returning an error if every route is empty.
Hidden reasoning is never shown as the user's answer.

A separate live fallback check observed Z.ai rate-limited, Gemini unavailable,
and a successful visible OpenRouter reply. Its requested exact answer-format
check did not pass, so this run confirms routing/availability but does not
verify response quality. The backend regression suite and `go vet` passed
after the empty-response fallback fix.

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

The latest owner-only machine-local report is:
`/tmp/my-padi-provider-verification-20261118.json`.
It contains test replies and metadata, never keys or hidden reasoning, and has
no pending greeting/fallback checks. Earlier reports described above were
retained under `/tmp/my-padi-quota-verification/` on the previous verification
machine. The later reasoning check is separate from this successful report.

## Configuration and rerunning

For current development testing, `PADI_DEV_BYPASS_AI_USAGE_LIMITS='true'` skips
PADI's daily/monthly request and token caps. The API and verifier still reserve
and record usage in PostgreSQL. The switch requires `PADI_ENV='development'`
and defaults to false. A real PostgreSQL check passed for exceeding all four
caps, preserving both ledger rows and actual usage, restoring normal
enforcement, and cleaning up its own test-only rows. Vendor rate limits and
free-account/model checks are unchanged. The three-hour work/rest proposal
remains unimplemented.

The private environment file is `backend/.env`, excluded from Git and mode
`0600`. All four provider keys are configured, with Z.ai enabled as
`zai-reasoning` and `PADI_AI_REASONING_MODEL='zai-reasoning'`.
Gemini remains primary, Groq is the fast route, and OpenRouter is backup.
The committed `.env.example` contains empty keys and a commented
four-provider configuration with the selected free model IDs.

Keep keys in the backend environment file, with one active assignment per key;
a later empty assignment overrides an earlier populated value. Restart the
backend after changing models, roles, or credentials.
Runtime Z.ai configuration accepts only `glm-4.7-flash`; the
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
