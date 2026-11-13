# PADI API

The initial Go backend for My PADI uses the standard `net/http` package and has no third-party dependencies. Requires Go 1.22 or later.

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

Startup, shutdown, and server errors are logged. Ctrl+C (`SIGINT`) or `SIGTERM` starts a graceful shutdown with up to 10 seconds for active requests to finish. The server uses a 5-second header read timeout, 10-second read and write timeouts, and a 60-second idle timeout.

## Health endpoint

```sh
curl --fail-with-body --include http://localhost:8080/health
```

A successful `GET /health` returns HTTP 200 with `Content-Type: application/json`:

```json
{"status":"ok","service":"padi-api"}
```

This endpoint confirms that the HTTP process is running. It does not check a database, AI service, or any other external dependency.

Other methods on `/health`, including `HEAD`, return HTTP 405 with `Allow: GET`. Unregistered paths return HTTP 404. Error responses use the standard library's plain-text format.

## Format and verify

Run from `backend/`:

```sh
gofmt -w cmd/api internal/config internal/httpapi
go test ./...
go vet ./...
```

Tests cover the health response status, JSON body, content type, unsupported methods, unknown routes, and environment-based address configuration.

## Layout

- `cmd/api/main.go`: server startup, logging, timeouts, and signal-driven shutdown.
- `internal/config/`: reads `PADI_HTTP_ADDR` with the default `:8080`.
- `internal/httpapi/`: routes, health handler, and HTTP tests.
- `go.mod`: standalone backend module with no external dependencies.

Only the backend foundation is implemented. PostgreSQL, authentication, AI services, and frontend integration are future work.
