FROM golang:1.24-bookworm AS builder

WORKDIR /src
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /src/backend
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /out/padi-api ./cmd/api

FROM python:3.12-slim

WORKDIR /app
COPY --from=builder /out/padi-api /app/padi-api
COPY services/padi_personality /app/services/padi_personality

ENV PADI_PERSONALITY_ROOT=/app/services
ENV PADI_PERSONALITY_PYTHON=python3

EXPOSE 10000

CMD ["/app/padi-api"]
