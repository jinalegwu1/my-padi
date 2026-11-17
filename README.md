# My PADI

**Built with Nigeria in mind. Designed to connect with the world.**

My PADI is a conversation-first, multilingual AI companion in development. It
aims to help people learn, communicate, think, create, stay organised, and enjoy
meaningful conversations through text and voice.

## Technology direction

- **Go:** Main backend, APIs, provider routing, business logic, and application
  services.
- **React Native + TypeScript:** Android/iOS application and user interface.
- **Python:** Specialist AI services when needed.
- **PostgreSQL:** Persistent application data and source of truth.
- **Gemini, OpenRouter, Groq, and Z.ai:** One configurable AI layer behind
  PADI's consistent identity.

The provider responsibilities, routing policy, free-model safeguards, and
implementation status are documented in the
[AI provider and technology responsibility agreement](./docs/ai-provider-responsibilities.md).

## Current status

The mobile app now has a real-chat connection path: phone sign-in by Termii
one-time code, secure session storage, and authenticated messages to the Go
chat API. Go routes those messages through the configured AI provider adapters
and usage limits. This path still requires operator-provided Termii credentials,
PostgreSQL, and approved provider model credentials before it can return live
responses. Real PostgreSQL quota tests passed, and backend verification obtained
real replies from the selected free Gemini, Groq, and OpenRouter models plus a
controlled primary-to-backup fallback. Z.ai's GLM-4.7-Flash adapter is tested;
its live check awaits the account key. See the [provider verification results](./docs/provider-verification.md).
Live SMS delivery and complete mobile sign-in/chat still need verification.
Voice remains simulated; reminders remain local and are not scheduled as
background notifications. Chat transcripts are
still stored on the phone, not PostgreSQL; persistent memory and specialist
Python services are not connected.

## Run frontend and backend

Use Node.js 20.19.4 or a newer compatible version, npm, and Go 1.22 or later.
From the repository root:

```sh
npm ci --prefix frontend
npm run migrate
npm run dev
```

`npm run migrate` loads `backend/.env` and applies the existing migrations to
its configured database. PostgreSQL must be running. `npm run dev` loads the
environment files and starts both servers. If the My PADI backend is already
running and database-ready when required, the launcher reuses it. Restart that backend to apply backend `.env`
changes. Ctrl+C stops the processes started by the launcher.

| Service | Local address | Configuration |
| --- | --- | --- |
| Go API | `http://127.0.0.1:8080` | `PADI_HTTP_ADDR='0.0.0.0:8080'` in `backend/.env` |
| Expo web/mobile development | `http://localhost:8081` | `PADI_FRONTEND_PORT='8081'` in `backend/.env` |
| Frontend API connection | `http://127.0.0.1:8080` | `EXPO_PUBLIC_API_URL` in `frontend/.env` |

Keep database settings, provider keys, and Termii settings in `backend/.env`.
The frontend environment contains its public API address. On a physical phone
in native development, a loopback API URL uses Expo's LAN host while keeping
the backend port. Connect the phone to the computer's network. Explicit remote
API addresses and production builds keep the configured address.

The current workspace has a separate `my_padi_dev` database on its private
local PostgreSQL instance. The instance must stay running for this development
configuration. Phone sign-in still requires the Termii settings described in
the backend README.

See the [backend README](./backend/README.md) for Go setup and tests. The
development goal is **one feature at a time: implement, test, and verify before
claiming it works.**
