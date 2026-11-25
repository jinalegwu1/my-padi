# PADI API

The Go backend for My PADI uses the standard `net/http` package and PostgreSQL for persistent data. Requires Go 1.22 or later.

## Run locally

To start the frontend and backend together, run `npm run dev` from the
repository root. The launcher reads `backend/.env` as data and passes its
settings only to Go. A My PADI backend already running on the selected port is
reused; restart it to load changed backend environment settings.
`PADI_HTTP_ADDR` chooses the backend address;
`PADI_FRONTEND_PORT` chooses Expo's port. `npm run migrate` loads the same
backend environment and applies migrations explicitly before startup.

The direct Go command below reads settings from the current process
environment; it does not load `.env` on its own.

From the repository root:

```sh
cd backend
go run ./cmd/api
```

The default HTTP address is `:8080`. Set `PADI_HTTP_ADDR` to choose another address:

```sh
PADI_HTTP_ADDR=127.0.0.1:9090 go run ./cmd/api
```

Set `DATABASE_URL` to enable and verify the PostgreSQL connection at startup. `PADI_DATABASE_URL` is accepted as a legacy alias:

```sh
DATABASE_URL='postgres://padi:password@localhost:5432/padi?sslmode=disable' go run ./cmd/api
```

Run schema migrations explicitly before enabling AI models; API startup never applies schema changes:

```sh
cd backend
DATABASE_URL='postgres://localhost:5432/padi?sslmode=disable' go run ./cmd/migrate
```

## Multi-model AI foundation

For the focused real-account check of all four providers, use the
[free-provider verification workflow](../docs/provider-verification.md).
`go run ./cmd/verifyproviders --env-file .env --catalog-only` checks catalogues
without generating responses. Full verification requires the account keys,
confirmed free access, approved models, and the PostgreSQL usage ledger.

The Go backend provides a provider-neutral generation interface, configurable model registry and routing roles, bounded timeouts/retries, fallback, circuit breaking, and usage/cost telemetry. Runtime configuration supports the four selected providers: Gemini, OpenRouter, Groq, and Z.ai. PADI's agreed provider responsibilities and the difference between planned and implemented capabilities are documented in [the AI provider responsibilities agreement](../docs/ai-provider-responsibilities.md). Runtime model IDs and provider assignments remain environment-configured; no model is selected by default.

Configure approved free model IDs and API-key environment variable names without putting credentials in the JSON:

```sh
export GROQ_API_KEY='your-secret'
export OPENROUTER_API_KEY='your-secret'
export PADI_AI_APPROVED_FREE_MODELS='groq:your-evaluated-model-id,openrouter:provider/model-id-verified-free'
export PADI_AI_MODELS='[{"id":"main","provider":"groq","model":"your-evaluated-model-id","api_key_env":"GROQ_API_KEY"},{"id":"backup","provider":"openrouter","model":"provider/model-id-verified-free","api_key_env":"OPENROUTER_API_KEY"}]'
export PADI_AI_PRIMARY_MODEL='main'
export PADI_AI_FAST_MODEL='main'
export PADI_AI_BACKUP_MODEL='backup'
```

Use `provider` values `gemini`, `openrouter`, `groq`, or `zai`; startup rejects other provider names. These providers use their standard API endpoint when `endpoint` is omitted. Z.ai currently accepts only the free `glm-4.7-flash` model with `ZAI_API_KEY`, using `https://api.z.ai/api/paas/v4/chat/completions`. Other provider model IDs remain configurable and must match the current catalog and approved free-account configuration. Set `api_key_env` to the environment variable containing that provider's credential. Every configured model must be exactly listed in `PADI_AI_APPROVED_FREE_MODELS` using comma-separated `provider:model-id` entries. This operator-maintained list blocks unapproved model IDs but is not a live price feed; verify free pricing, quotas, and terms with each provider and recheck regularly. Configure routing roles with `PADI_AI_PRIMARY_MODEL`, `PADI_AI_FAST_MODEL`, `PADI_AI_REASONING_MODEL`, and `PADI_AI_BACKUP_MODEL`. General text requests try the configured primary, backup, fast, then reasoning models after provider failures. With the active Groq primary/fast, OpenRouter backup, and Z.ai reasoning assignments, the effective sequence is Groq → OpenRouter → Z.ai for every task; task labels no longer pre-select Z.ai. Transient failures may retry the same model within its configured retry limit; other provider errors advance to the next model. Cancellation and local usage-ledger failures remain terminal. Live voice streaming remains restricted to configured Gemini/Groq streaming models; OpenRouter is not currently a supported voice-streaming fallback. The router applies shared PADI system instructions to all providers and skips retries against an HTTP 429-limited model. Callers should assign task labels through trusted Go logic, not accept model output as authorization. Requests can opt into JSON with `structured_output: true`; the router rejects non-JSON responses, but callers must still validate task-specific fields. The selected model must support JSON mode. Optional fields include `timeout_ms`, `retries` (0–2), and input/output cost per million tokens. Secrets are loaded only from the named environment variables and are not logged.

For example, configure the ordered Groq → OpenRouter → Z.ai chain only with operator-verified free models:

```sh
export GROQ_API_KEY='your-secret'
export OPENROUTER_API_KEY='your-secret'
export ZAI_API_KEY='your-secret'
export PADI_AI_APPROVED_FREE_MODELS='groq:your-evaluated-model-id,openrouter:provider/model-id-verified-free,zai:glm-4.7-flash'
export PADI_AI_MODELS='[{"id":"main","provider":"groq","model":"your-evaluated-model-id","api_key_env":"GROQ_API_KEY"},{"id":"backup","provider":"openrouter","model":"provider/model-id-verified-free","api_key_env":"OPENROUTER_API_KEY"},{"id":"reasoning","provider":"zai","model":"glm-4.7-flash","api_key_env":"ZAI_API_KEY"}]'
export PADI_AI_PRIMARY_MODEL='main'
export PADI_AI_FAST_MODEL='main'
export PADI_AI_BACKUP_MODEL='backup'
export PADI_AI_REASONING_MODEL='reasoning'
```

Replace example model IDs with exact IDs you have verified as free. The application cannot automatically verify live provider pricing or limits.

The registry is loaded and validated at startup. The generation service is exposed to mobile chat only through the authenticated `/v1/chat` endpoint; the provider adapters are contract-tested with local HTTP test servers, but live provider quality, outage behavior against each vendor, and provider/model assignments still require evaluation with configured credentials.

When `PADI_AI_MODELS` is configured, API startup requires `DATABASE_URL` and the persistent PostgreSQL usage ledger; otherwise it exits with an error. PADI applies per-provider caps of 20 requests/day, 300 requests/month, 25,000 reserved token units/day, and 250,000/month. Reserved units are the UTF-8 prompt byte count plus the output-token ceiling; actual provider input/output token usage is recorded separately. These are conservative PADI-side caps, not vendor free-tier guarantees. The protected chat API returns quota exhaustion explicitly and the app displays the error. Real PostgreSQL integration tests passed against a disposable database, including migrations, rollback, all four caps, and concurrent requests. See [the quota verification results](../docs/postgresql-quota-verification.md).

Keep database credentials out of source control. For local UI/API work without PostgreSQL, the server can still start without `DATABASE_URL`; `/health` remains available, while `/readyz` returns HTTP 503 until the database is configured and reachable. If a database URL is configured but the connection fails, startup exits with an error.

## Phone authentication and real chat

### Account-owned personal memory

Apply migrations before restarting the API. Migration 9 adds account-owned
memory facts and opt-in settings. Memory defaults to off; new facts require
explicit approval. The app's Memory screen connects review, creation,
correction, pause, deletion, and the master switch to authenticated APIs.
Relevant active facts may be added to AI requests only when enabled.

Memory changes advance a revision and prevent older recalled replies from
re-entering follow-up context. Existing transcripts remain local. See the
[memory API, limits, and verification results](../docs/personal-memory-verification.md).
Saving facts through conversation remains a future feature.

### Temporary development usage-cap bypass

To test extended conversations without PADI's daily/monthly request and token
caps, set these values in `backend/.env` and restart the backend:

```sh
PADI_ENV='development'
PADI_DEV_BYPASS_AI_USAGE_LIMITS='true'
```

The API and provider verifier continue reserving and recording usage in
PostgreSQL. Existing counters are preserved; no provider allowance is reset.
Provider rate limits, approved free-model checks, authentication, and request
timeouts still apply. Provider throttling has a distinct `provider_rate_limited`
API error, separate from PADI's `usage_limit_reached` error.

The switch defaults to false and is rejected outside `development`. Set it to
`false` and restart to restore PADI's normal caps against the preserved usage.
The proposed three-hour work/rest schedule is not implemented.

### Temporary development OTP bypass

For local testing, set these values in `backend/.env`, then restart the backend:

```sh
PADI_ENV='development'
PADI_DEV_BYPASS_OTP='true'
```

Registration and login return a real PostgreSQL session immediately, without
sending an SMS or asking for a code. The app reads `GET /v1/auth/config` and
labels this mode explicitly. Existing account eligibility, profile validation,
rate limits, session expiry/revocation, and chat authorization still apply.
No Termii credentials or auth pepper are needed in this mode. PostgreSQL and
the existing migrations are still required.

Phone ownership is not verified: use this only with development test accounts.
The backend rejects bypass unless `PADI_ENV` is exactly `development`; the
switch defaults to false. To restore OTP, set `PADI_DEV_BYPASS_OTP='false'`,
configure the Termii credentials and auth pepper below, and restart the backend.

### OTP-enabled sign-in

The mobile chat uses the authenticated Go endpoints below. Registration requires a full name, date of birth, and E.164 phone number. Login and registration send a six-digit code through Termii; verification issues a 30-day bearer session. On iOS/Android, the session is stored with Expo SecureStore. Browser preview uses per-tab `sessionStorage`.

Apply migrations before starting the API:

```sh
cd backend
DATABASE_URL='postgres://localhost:5432/padi?sslmode=disable' go run ./cmd/migrate
```

Configure Termii's account-specific HTTPS base URL from its [developer dashboard](https://developers.termii.com/) and a backend-only HMAC pepper (generate a unique random value of at least 32 bytes; never use the example placeholder):

```sh
export TERMI_API_KEY='your-termii-api-key'
export TERMI_SENDER_ID='your-approved-sender-id'
export TERMI_API_BASE_URL='https://api.ng.termii.com'
export PADI_AUTH_PEPPER='replace-with-a-random-secret-at-least-32-bytes'
export DATABASE_URL='postgres://localhost:5432/padi?sslmode=disable'
export PADI_CORS_ORIGINS='http://localhost:8081'
```

Configure the mobile app's public API address in `frontend/.env`. A physical phone must use a backend host reachable over the network; `localhost` on the phone means the phone itself. Set `PADI_CORS_ORIGINS` to the exact web-app origins needed. Do not put Termii credentials, the auth pepper, database credentials, or AI provider keys in the frontend.

Endpoints:

- `POST /v1/auth/register` with `full_name`, `date_of_birth` (`YYYY-MM-DD`), and `phone_number` (E.164).
- `POST /v1/auth/login` with `phone_number`.
- `POST /v1/auth/verify` with `challenge_id` and the six-digit `code`; returns the bearer session.
- `POST /v1/auth/logout` with `Authorization: Bearer <token>`.
- `POST /v1/chat` with the bearer token and recent user/assistant `messages`; returns `reply`.

Codes expire after five minutes, allow at most five guesses, and are stored only as peppered hashes. Challenge sends are limited per phone and source IP, and challenge records are purged after 24 hours. Sessions are revocable and expire after 30 days. The source IP is taken from the direct connection; do not trust arbitrary forwarded-IP headers. If deploying behind a proxy, configure the proxy and rate-limit boundary deliberately.

The chat endpoint validates roles and payload size, rejects unauthenticated requests, and calls the Go AI router with provider-neutral PADI instructions, approved-model checks, fallback, and PostgreSQL usage limits. Follow-up context uses successful authenticated exchanges belonging to the same account and memory revision. Relevant explicitly approved, active memories may be included when account memory is enabled. Local greetings, simulated messages, unrelated data, and other device preferences are excluded. Conversation history remains on the phone; approved memory facts are stored separately in PostgreSQL. Submitted context is forwarded to the configured AI provider, as disclosed in the app.

## Python Voice Engine

Go exposes authenticated `POST /v1/voice/transcribe` and
`POST /v1/voice/speak`, plus `GET /v1/voice/config`. The mobile/web client starts
one foreground microphone session, detects speaking turns, and sends them
automatically. It listens during responses and interrupts playback on speech.
Voice messages use the existing `/v1/chat` pipeline with spoken-delivery
instructions and interrupted-reply context. Account and memory revision
boundaries still apply.

The independent Python service in `services/voice` performs WebRTC VAD,
16 kHz mono PCM conversion, trimming, low-frequency rumble/DC reduction,
Groq Whisper recognition, transcript validation, and expressive Gemini speech
synthesis. Android/iPhone capture and echo cancellation use the new native
PadiVoice module; these require an Expo development build.

Set `PADI_STT_ENABLED=true` and `PADI_PYTHON_VOICE_ENABLED=true` in the local
backend environment. Configure `PADI_PYTHON_VOICE_URL` (loopback HTTP or HTTPS)
and an internal `PADI_VOICE_SERVICE_TOKEN` of at least 32 bytes. The launcher
starts Python on port 8090 and passes only its required Gemini/Groq credentials
and internal token. The frontend receives no private provider keys.

Prepare Python once from the project root:

```sh
python3 -m venv services/voice/.venv
services/voice/.venv/bin/python -m pip install -r services/voice/requirements.txt
npm run dev
```

Gemini and Groq must be included in `PADI_AI_FREE_ACCOUNT_CONFIRMED`. Speech
models are independent of the approved text-model registry. The initial
speech models are `whisper-large-v3-turbo` and `gemini-3.1-flash-tts-preview`;
free-tier availability was checked against official pricing and live calls.
Do not add speech models to `PADI_AI_APPROVED_FREE_MODELS`.

Recordings are bounded to 8 MB and up to 60 seconds per segment. Audio is
processed in memory by Go/Python and never logged or saved by these servers.
Temporary device upload files are deleted. Speech request accounting uses
separate `groq-speech` and `gemini-voice` ledger buckets; Gemini input text
usage enters the text-token columns, while audio output is not counted as
text tokens. Existing development quota bypass applies; provider account
limits still apply. See [voice verification](../docs/voice-verification.md)
and the [Python roadmap](../docs/python-roadmap.md).

## Health endpoint

```sh
curl --fail-with-body --include http://localhost:8080/health
```

A successful `GET /health` returns HTTP 200 with `Content-Type: application/json`:

```json
{"status":"ok","service":"padi-api"}
```

This endpoint confirms that the HTTP process is running. It does not check PostgreSQL, AI services, or any other external dependency.

## Readiness endpoint

```sh
curl --fail-with-body --include http://localhost:8080/readyz
```

`GET /readyz` returns HTTP 200 with `{"status":"ready","service":"padi-api"}` when PostgreSQL is reachable. It returns HTTP 503 with `{"status":"not_ready","service":"padi-api"}` when PostgreSQL is not configured or cannot be reached. The connection check has a 2-second request timeout. `/ready` remains as a compatibility alias.

Other methods on `/health`, `/readyz`, and `/ready`, including `HEAD`, return HTTP 405 with `Allow: GET`. Unregistered paths return HTTP 404. Error responses use the standard library's plain-text format.

## Format and verify

Run from `backend/`:

```sh
gofmt -w cmd/api internal/ai internal/auth internal/config internal/database internal/httpapi
go test ./...
go vet ./...
```

Tests cover AI model configuration, routing, fallback, circuit breaking, telemetry, provider adapter request/response contracts, phone-authentication challenge/session logic, protected chat authorization and validation, profile validation, health and readiness responses, unavailable database behavior, unsupported methods, unknown routes, embedded migration ordering, database connection-string validation, and environment-based configuration. PostgreSQL authentication/usage integration tests run only when `PADI_TEST_DATABASE_URL` points to a disposable database.

To opt into the PostgreSQL connection integration test, point `PADI_TEST_DATABASE_URL` only at a disposable test database:

```sh
PADI_TEST_DATABASE_URL='postgres://padi:password@localhost:5432/padi_test?sslmode=disable' go test ./internal/database -run TestPostgresConnectionIntegration
```

The test skips when this dedicated variable is absent; it never uses `DATABASE_URL` or its legacy alias.

## Layout

- `cmd/api/main.go`: server startup, PostgreSQL connection, logging, timeouts, and signal-driven shutdown.
- `cmd/migrate/main.go`: explicit PostgreSQL schema migration command.
- `internal/config/`: reads `PADI_HTTP_ADDR` and optional `DATABASE_URL` (`PADI_DATABASE_URL` legacy alias).
- `internal/ai/`: provider-neutral request/response types, model registry, task routing, resilience controls, telemetry, and provider adapters.
- `internal/auth/`: phone OTP and Termii SMS client, challenge/session service, profile validation.
- `internal/database/`: PostgreSQL connection pool, auth/session and AI usage stores, and explicit migrations. Startup does not apply schema changes; run `go run ./cmd/migrate` explicitly.
- `internal/httpapi/`: health/readiness, phone-authentication, protected chat, CORS allowlist, and handler tests.
- `go.mod`: standalone backend module.

Phone OTP, Termii delivery, revocable PostgreSQL sessions, and authenticated AI chat endpoints are implemented. OTP-enabled sign-in requires database migrations, Termii credentials and the account-specific HTTPS base URL, the auth pepper, an exact web-origin allowlist where needed, and AI provider configuration. Development OTP bypass skips the SMS requirements. All four providers returned live greetings with checked free-model configuration; complex-task suitability and ongoing vendor pricing still need evaluation. Live SMS delivery and complete mobile sign-in/chat remain unverified. The Python Voice Engine is connected and its browser flow is tested; native compilation/device verification remains pending. Chat history stays local; PostgreSQL conversation persistence and the other Python engines remain planned.
