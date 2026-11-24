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
spoken replies, and automatic listening after each reply. Tapping PADI's picture
wakes the conversation; silence ends a turn, and genuine speech interrupts PADI
while echo cancellation rejects its speaker audio. Go retains
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
PADI's current-turn personality guidance and account-scoped humour/tone
preferences are implemented; mood labels are not persisted, and learning from
response feedback is opt-in. Users can also configure account-synced morning,
afternoon, and evening check-ins. Native apps can register for account-backed
remote push delivery through the Go API, PostgreSQL, and Expo Push Service;
local notifications remain the fallback when remote setup is unavailable.
Quiet hours, saved timezones, delivery deduplication, and notification-tap
routing are implemented. Expo ticket acceptance is recorded, but does not
confirm delivery to a device. See the [push notification setup and status](./docs/push-notifications.md).
Reminders, event alerts, and conversation follow-ups are not part of this
check-in-only push implementation. Targeted regression tests exercise feedback
adaptation across three chat turns, distress overriding learned humour, account
boundaries, and the shared instructions serialized for all eight Go AI provider
adapters. Check-in tests cover reload and timezone resynchronization, quiet-hour
boundaries, permission denial, and duplicate replacement. A voice HTTP test
carries exact generated text through the authenticated Python endpoint and
speech-payload builder with only the external provider stubbed.

These are controlled unit/HTTP fixtures, not live PostgreSQL or live AI-provider
tests. A fresh client mount reloading server preferences does not prove that a
device delivers notifications after an actual app restart or timezone change;
physical-device verification remains needed. Backend `go test ./...` passes
after the push changes. This environment does not provide Node.js or npm, so the
frontend typecheck and new push tests could not be rerun; editor diagnostics
reported no TypeScript errors in the changed application files. The full
frontend suite previously had unrelated portrait/voice test failures because
its test loader could not resolve `@/lib/portrait-speech` and a bundled portrait
asset was missing.
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

The launcher also reuses Expo when the configured port already serves this
checkout, and verifies that a reused API accepts that browser origin. Open the
printed frontend URL. If Expo offers to move from `8081` to `8082`, cancel and
use the existing `http://localhost:8081` instance: the API may only allow the
configured port. To deliberately change ports, set `PADI_FRONTEND_PORT` in
`backend/.env` and restart the backend through `npm run dev` so its CORS origins
match. Another project's server is never reused or stopped automatically.

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
