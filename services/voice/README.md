# PADI Python Voice Engine

This service owns audio intelligence: WebRTC VAD, signal preparation, audio
conversion/segmentation, speech recognition, transcript validation, and
expressive speech models. Go owns accounts, permissions, chat/model routing,
memory consent and PostgreSQL usage tracking. The client owns microphone
capture, immediate interruption signals, and playback through the OS audio path.

This service is separate from the other seven planned Python engines.
See [the agreed roadmap](../../docs/python-roadmap.md).

## Run and test

From the project root:

```sh
python3 -m venv services/voice/.venv
services/voice/.venv/bin/python -m pip install -r services/voice/requirements.txt
services/voice/.venv/bin/python -m unittest discover -s services/voice -v
npm run dev
```

`npm run dev` starts this service only when `PADI_PYTHON_VOICE_ENABLED=true` in
the backend environment. It listens on loopback port 8090 and receives only
its required server-side credentials. Restart the development servers after
changing Python source or backend configuration.

Internal endpoints:

- `GET /health`: readiness identity, without credentials or user content.
- `POST /transcribe`: token-protected multipart audio from Go. Voice detection,
  PCM conversion, trimming/filtering, then Groq Whisper speech recognition.
- `POST /synthesise`: token-protected text/style/rate from Go. Gemini returns
  actual speech audio; Python validates and wraps it as playable mono WAV.

No CORS access is granted directly to apps, and user-facing APIs remain in Go.
There are no mock transcripts or simulated speech. Audio/text/credentials are
not logged or persisted. Inputs and responses are bounded and provider errors
are sanitised. The standard-library server is intended behind Go's private
boundary, not as a public unauthenticated endpoint.

## Current limits

Foreground conversations only. Phone echo handling requires development
builds containing the local native module, and device verification is pending.
Signal filtering reduces low-frequency rumble/DC; it is not a guarantee of
isolating one speaker or removing every background noise. Speech/model quality
and provider quotas remain practical constraints. See the
[verification checklist](../../docs/voice-verification.md).
