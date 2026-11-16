# PADI API

The Go backend for My PADI uses the standard `net/http` package and PostgreSQL for persistent data. Requires Go 1.22 or later.

## Run locally

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

## Multi-model AI foundation

The Go backend provides a provider-neutral generation interface, configurable model registry and routing roles, bounded timeouts/retries, fallback, circuit breaking, and usage/cost telemetry. It includes HTTP adapters for OpenAI, Anthropic, Gemini, and OpenAI-compatible endpoints (including Groq-compatible APIs). Provider/model assignments are not selected by default; evaluate them for PADI before choosing production roles.

Configure model IDs and API-key environment variable names without putting credentials in the JSON:

```sh
export OPENAI_API_KEY='your-secret'
export PADI_AI_MODELS='[{"id":"main","provider":"openai","model":"your-evaluated-model-id","api_key_env":"OPENAI_API_KEY"}]'
export PADI_AI_PRIMARY_MODEL='main'
```

Additional model entries can use providers `anthropic`, `gemini`, or `openai-compatible`. OpenAI-compatible providers require an `endpoint` with the full chat-completions URL. Optional fields include `timeout_ms`, `retries` (0–2), and input/output cost per million tokens. Configure routing roles with `PADI_AI_FAST_MODEL`, `PADI_AI_REASONING_MODEL`, and `PADI_AI_BACKUP_MODEL`. Secrets are loaded only from the named environment variables and are not logged.

The registry is loaded and validated at startup. The generation service is not exposed as an unauthenticated HTTP endpoint; connecting it to user chat is deferred until authenticated chat workflows are implemented. The included adapters are contract-tested with local HTTP test servers, but live provider quality, outage behavior against each vendor, and provider/model assignments still require evaluation with configured credentials.

Keep database credentials out of source control. For local UI/API work without PostgreSQL, the server can still start without `DATABASE_URL`; `/health` remains available, while `/readyz` returns HTTP 503 until the database is configured and reachable. If a database URL is configured but the connection fails, startup exits with an error.

Startup, shutdown, and server errors are logged. Ctrl+C (`SIGINT`) or `SIGTERM` starts a graceful shutdown with up to 10 seconds for active requests to finish. The server uses a 5-second header read timeout, 10-second read and write timeouts, and a 60-second idle timeout.

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

Tests cover AI model configuration, routing, fallback, circuit breaking, telemetry, provider adapter request/response contracts, profile validation, health and readiness responses, unavailable database behavior, unsupported methods, unknown routes, embedded migration ordering, database connection-string validation, and environment-based configuration.

To opt into the PostgreSQL connection integration test, point `PADI_TEST_DATABASE_URL` only at a disposable test database:

```sh
PADI_TEST_DATABASE_URL='postgres://padi:password@localhost:5432/padi_test?sslmode=disable' go test ./internal/database -run TestPostgresConnectionIntegration
```

The test skips when this dedicated variable is absent; it never uses `DATABASE_URL` or its legacy alias.

## Layout

- `cmd/api/main.go`: server startup, PostgreSQL connection, logging, timeouts, and signal-driven shutdown.
- `internal/config/`: reads `PADI_HTTP_ADDR` and optional `DATABASE_URL` (`PADI_DATABASE_URL` legacy alias).
- `internal/ai/`: provider-neutral request/response types, model registry, task routing, resilience controls, telemetry, and provider adapters.
- `internal/auth/`: profile validation for full name, date of birth, and E.164 phone number.
- `internal/database/`: PostgreSQL connection pool plus dormant later-phase migration code for users, OTP challenges, and sessions. Startup does not apply schema changes.
- `internal/httpapi/`: routes, health/readiness handlers, and HTTP tests.
- `go.mod`: standalone backend module.

The authentication schema and profile validation are in place, but the OTP request/verification endpoints, SMS delivery adapter, and session workflows are not implemented yet. Phone number ownership will be verified by SMS; the delivery vendor remains unselected. The AI platform foundation and provider adapters are present, but live model evaluation, authenticated chat integration, and frontend connection remain future work.
