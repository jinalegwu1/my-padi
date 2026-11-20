# PADI Python Voice Engine

This service owns audio intelligence: WebRTC VAD, signal preparation, audio
conversion/segmentation, speech recognition, transcript validation, and
expressive speech models. Go owns accounts, permissions, chat/model routing,
memory consent and PostgreSQL usage tracking. The client owns microphone
capture, immediate interruption signals, and playback through the OS audio path.

This is one of Python's three approved intelligence engines. The memory/context
and quality/evaluation engines are separate future responsibilities.
See [the agreed roadmap](../../docs/python-roadmap.md).

## Run and test

From the project root:

```sh
npm run setup:voice
services/voice/.venv/bin/python -m unittest discover -s services/voice -v
npm run dev
```

`npm run dev` starts this service only when `PADI_PYTHON_VOICE_ENABLED=true` in
the backend environment. It listens on loopback port 8090 and receives only
its required server-side credentials. Restart the development servers after
changing Python source or backend configuration.

`PADI_VOICE_MODEL` selects `gemini-3.1-flash-tts-preview`,
`gemini-3.8-flash-tts`, or `gemini-3.8-flash-lite-tts`. The configured development
workspace now uses Flash-Lite TTS, with published free-tier pricing, account
access, and a real audio-generation request checked.
An optional `PADI_VOICE_DEFAULT_ID` selects a project-scoped original voice
created through Gemini Voice design for the default PADI style. Keep this
setting in the backend environment; the app continues sending its existing
voice style IDs. Other named choices use their corresponding prebuilt voices.

Go can preserve fixed introductions/previews in `PADI_VOICE_SAMPLE_CACHE_DIR`.
This avoids regenerating public phrases after a backend restart. The configured
development cache is ignored by Git and contains public clips only; account
names, personal greetings and conversation speech are not stored there.

Gemini 3.5 Flash produces text and cannot generate these voice replies. Both
3.8 TTS variants support the same original voice profile and speech metadata.
Changing the speech model does not remove the provider's account quotas.

With the services running, `npm run verify:voice` checks real authenticated
transcription, silence rejection, AI replies, and playable Python-generated
speech using a public audio sample and a temporary account. The test verifies
cleanup and records normal provider usage in PostgreSQL.

`npm run verify:voice:browser` additionally checks the app's voice/text context,
automatic turns, playback interruption, continuation, Pause/End, microphone
denial, and a controlled service failure. Install frontend dependencies first
and use an installed Google Chrome, or set `PADI_VOICE_BROWSER_EXECUTABLE` to a
compatible Chromium executable. The browser uses isolated test storage and
public/synthetic speech; it never opens a personal microphone. These commands
require the configured development environment and confirmed free accounts.

Internal endpoints:

- `GET /health`: readiness identity, without credentials or user content.
- `POST /transcribe`: token-protected multipart audio from Go. Voice detection,
  PCM conversion, trimming/filtering, then Groq Whisper speech recognition.
- `POST /synthesise`: token-protected text/style/rate/language from Go. Gemini returns
  actual speech audio; Python validates and wraps it as playable mono WAV.

No CORS access is granted directly to apps, and user-facing APIs remain in Go.
There are no mock transcripts or simulated speech. Audio/text/credentials are
not logged or persisted. Inputs and responses are bounded and provider errors
are sanitised. The standard-library server is intended behind Go's private
boundary, not as a public unauthenticated endpoint.

## Current limits

PADI's default voice uses a fuller, confident adult male character. The current
development configuration selects an original Nigerian voice profile created
from a description, without reference audio or real-person imitation. All styles
receive conversational delivery instructions; Nigerian English and Pidgin
receive explicit pronunciation and cadence directions. Greetings and voice
conversations pass the selected language rather than dropping it. Public
previews use fixed Nigerian English phrases, with Pidgin for Tunde. Voice quality
and accent accuracy still require human listening; generated audio alone does
not establish that a voice sounds natural.

For Gemini 3.8, spoken text and delivery metadata are separate so directions
are not read aloud. Its WAV output is validated and normalised to the same
24 kHz mono PCM format used by Go and the app. The earlier engine's PCM output
remains supported. No PADI usage-limit behaviour was changed during this update.

Foreground conversations only. Phone echo handling requires development
builds containing the local native module, and device verification is pending.
Signal filtering reduces low-frequency rumble/DC; it is not a guarantee of
isolating one speaker or removing every background noise. Speech/model quality
and provider quotas remain practical constraints. See the
[verification checklist](../../docs/voice-verification.md).
