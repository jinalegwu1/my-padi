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

The [Python specialist-service roadmap](./docs/python-roadmap.md) defines the
three approved intelligence engines and their boundaries with Go.

## Current status

The mobile app now has a real-chat connection path: phone sign-in by Termii
one-time code, secure session storage, and authenticated messages to the Go
chat API. Go routes those messages through the configured AI provider adapters
and usage limits. This path still requires operator-provided Termii credentials,
PostgreSQL, and approved provider model credentials before it can return live
responses. Real PostgreSQL quota tests passed, and backend verification obtained
real greetings from the selected free Gemini, Groq, OpenRouter, and Z.ai models
plus a controlled primary-to-backup fallback. Z.ai's separate reasoning check
remains pending after provider rate limits. See the [provider verification results](./docs/provider-verification.md).
Live SMS delivery and complete mobile sign-in/chat still need verification.
For temporary local testing, an explicit development setting can bypass OTP
and issue real PostgreSQL sessions without SMS. See the
[development OTP bypass instructions](./backend/README.md#temporary-development-otp-bypass).
PADI-side usage caps can also be temporarily disabled in development while
keeping the PostgreSQL ledger; provider limits still apply. See the
[usage-cap bypass instructions](./backend/README.md#temporary-development-usage-cap-bypass).
Voice now supports a hands-free conversation flow through a separate Python
Voice Engine: automatic speaking-turn detection, speech recognition, expressive
spoken replies, and interruption when the user starts talking. Go retains
account authentication, shared chat context, memory permissions, and usage
tracking. The browser flow passed an end-to-end test. Android/iPhone require
an Expo development build with the new native echo-cancelled capture module;
native compilation and physical device checks remain pending. See
[voice verification and setup](./docs/voice-verification.md).
Reminders remain local and are not
scheduled as background notifications. Chat transcripts are
still stored on the phone, not PostgreSQL. Personal memory now stores explicitly
approved facts against accounts in PostgreSQL, with opt-in use in relevant AI
replies and review, correction, pause, and deletion controls. See the
[personal-memory verification](./docs/personal-memory-verification.md).
Automatic memory extraction and the other Python intelligence engines remain planned.

## Run frontend and backend

Use Node.js 20.19.4 or a newer compatible version, npm, and Go 1.22 or later.
From the repository root:

```sh
npm ci --prefix frontend
npm run setup:voice
npm run migrate
npm run dev
```

`npm run migrate` loads `backend/.env` and applies the existing migrations to
its configured database. PostgreSQL must be running. `npm run dev` loads the
environment files and starts both servers. If the My PADI backend is already
running and database-ready when required, the launcher reuses it. Restart that
backend to apply backend `.env` changes. Ctrl+C stops the processes started by
the launcher.

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

Set `DATABASE_URL` in `backend/.env` to your PostgreSQL service, including Neon
if that is your chosen host. Apply migrations to that database before starting
the API. Phone sign-in still requires the Termii settings described in the
backend README.

See the [backend README](./backend/README.md) for Go setup and tests. The
development goal is **one feature at a time: implement, test, and verify before
claiming it works.**
