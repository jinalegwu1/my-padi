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
In a hands-free call, PADI shows live captions, sends the finished turn automatically,
and starts speaking while its reply text is still arriving. The microphone stays open
during playback so the user can interrupt. Go authenticates the session and applies
the existing chat, memory, and usage rules.

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
physical-device verification remains needed. Automatic memory extraction and the other Python intelligence engines remain planned.

## Nigerian voices and live captions

Select **PADI** for the male voice or **Ada** for the female voice in Settings → Voice.
Use **Preview voice** to audition them. Nigerian English and Nigerian Pidgin use
two local neural voice models. Existing persona choices map to the corresponding
male or female model. A call displays your changing transcript and PADI’s
answer. Speaking again clears the pending audio and starts the next turn.

The engineering target is first visible reply text and first audible speech within
three seconds of the last spoken word on 95 of 100 warm calls. Provider response
time, network conditions, and inference hardware all contribute. The device
benchmark and listening review are described in the [live voice guide](./docs/live-voice-conversation.md).

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
its configured database. PostgreSQL must be running. Voice setup downloads the
pinned live recognizer and both voice checkpoints into `services/voice/models/`.
In `backend/.env`, enable `PADI_STT_ENABLED` and `PADI_PYTHON_VOICE_ENABLED`,
select `PADI_PYTHON_VOICE_ENGINE=local`, and set a private `PADI_VOICE_SERVICE_TOKEN`
of at least 32 characters. Uploaded recordings and extra input languages also use
the Whisper checkpoint described in the [speech service setup](./services/voice/README.md). `npm run dev` loads the
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
