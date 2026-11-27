# PADI Python Voice Engine

Live conversations send microphone PCM to a persistent Vosk recognizer through
the authenticated Go WebSocket. English and Pidgin captions revise in place. The
configured chat model writes the reply. PADI uses the local adult female
Nigerian VITS checkpoint for Nigerian English and Pidgin. The signature profile
adds phrasing, pause timing and headroom. The player receives 24 kHz mono audio in order.
Other installed output locales continue to use eSpeak NG. Uploaded recordings
and input locales outside the live recognizer use Faster-Whisper.

Run `npm run setup:voice` from the root to install the Python runtime, speech
dependencies and pinned conversation models. The speech service loads the models
from disk. The en-US Vosk checkpoint is a general English recognizer. Assess
Pidgin, names and regional accents using actual speech. The two Nigerian-accented
voice checkpoints support an English alphabet and accept Pidgin text. The live
recognizer flags standalone “I” transcripts from recordings of up to 2.5 seconds
when the client supports a second check. The client checks the retained audio
with the installed Whisper worker, which can recover a weak initial “h”. Listen to the
current candidates and review the measured limitations in the
[signature voice report](../../docs/signature-voice.md).

For file transcription, run `services/voice/.venv/bin/python services/voice/install_model.py --model base`.
Set `PADI_STT_ENABLED=true`, `PADI_PYTHON_VOICE_ENABLED=true`,
`PADI_PYTHON_VOICE_ENGINE=local` and a shared private `PADI_VOICE_SERVICE_TOKEN`.
Use `PADI_LIVE_STT_MODEL_PATH` to select a compatible local Vosk directory.
`PADI_NIGERIAN_VOICE_DIR` points to the parent of `naija-male` and `naija-female`.
CPU speed affects the time to first audio and whether synthesis keeps up with playback.
After installing models, restart Python and check `/v1/voice/config` on Go.

Model sources are [Vosk small English](https://alphacephei.com/vosk/models),
[Uphando Nigerian male](https://huggingface.co/Uphando-ng/naija_eng_male_accent_tts)
and [Uphando Nigerian female](https://huggingface.co/Uphando-ng/naija_eng_female_accent_tts).

## Previous cloud speech integration (inactive with the local engine)


This service owns audio intelligence: WebRTC VAD, signal preparation, audio
conversion/segmentation, speech recognition, transcript validation, and
expressive speech models. Go owns accounts, permissions, chat/model routing,
memory consent and PostgreSQL usage tracking. The client owns microphone
capture, immediate interruption signals, and playback through the OS audio path.

This is one of Python's three approved intelligence engines. The memory/context
and quality/evaluation engines are separate future responsibilities.
See [the agreed roadmap](../../docs/python-roadmap.md).

### Historical cloud-engine setup and verification

From the project root:

```sh
npm run setup:voice
services/voice/.venv/bin/python -m unittest discover -s services/voice -v
npm run dev
```

`npm run dev` starts this service when `PADI_STT_ENABLED=true` or
`PADI_PYTHON_VOICE_ENABLED=true` in
the backend environment. It listens on loopback port 8090 and receives only
its required server-side credentials. Restart the development servers after
changing Python source or backend configuration.

`PADI_VOICE_MODEL` selects `gemini-2.5-flash-preview-tts`, `gemini-3.1-flash-tts-preview`,
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

When a newer model is rate-limited or unavailable, Go tries the supported
`gemini-2.5-flash-preview-tts` fallback. `PADI_VOICE_FALLBACK_MODEL` selects a
supported alternative; an empty value disables fallback. Each provider attempt
reserves usage through Go. Provider retry timing prevents repeated requests to
an exhausted model until its quota resets. The earlier model uses the selected
persona's prebuilt voice, since it cannot use an original 3.8 voice profile.

Tapping PADI's picture requests microphone permission and plays a short,
greeting, then keeps listening and replying automatically. Live greetings and
responses use authenticated Groq speech; voice conversations do not fall back
to Gemini. Ordinary introductions/previews keep their separate public cache.
Silence ends each listening turn without closing the conversation. The microphone
continues monitoring during playback. Device AEC and a playback PCM reference
reject speaker echo; genuine user speech cancels current and queued audio.
The user turn closes after one second of continuous silence.
Exiting or switching to text closes capture and
playback; tapping PADI again greets and resumes the same shared conversation.
Ordinary voice turns use short replies and the fast model route; long spoken
answers can start their first sentence while the next passage is generated.
The five-second response goal still depends on network and provider latency.

`PADI_LIVE_VOICE_PROVIDER=groq` enables the separate Orpheus speech model for
English/Pidgin at normal pace. The chat model still generates the words; Python
passes those same words to speech without generating a second answer. The Groq
organization admin must first accept the Orpheus model terms in its console.
Until then, keep the default Gemini setting. Unsupported languages or paces
and unavailable fast speech fall back to Gemini. Both providers retain their
own usage reservations, and no device speech is substituted. Public preview
cache keys include the live provider so previews follow the selected engine.

Those fallback rules describe the general speech/preview endpoints. The live
voice-conversation client selects `groq_only` for greetings and responses and
reports failures instead of falling back to Gemini.

For expressive delivery and the configured Nigerian English voice, use
`PADI_LIVE_VOICE_PROVIDER=gemini` (the default). Orpheus uses a different set of
standard English voices and does not carry Gemini's custom voice profile or
accent directions. Choosing it for speed changes how PADI sounds.

The voice configuration advertises `language_selection`. Supported clients
pass the selected language to recognition, chat and previews in existing voice conversations. English capture
uses Whisper's `en` language instead of automatic detection; chat receives an
explicit selected-language instruction and speech does not add translations
or unsolicited language switches. Existing clients default to English. Voice
identity no longer forces a Pidgin preview when English is selected.

With the services running, `npm run verify:voice` checks real authenticated
transcription, silence rejection, AI replies, and playable Python-generated
speech using a public audio sample and a temporary account. The test verifies
cleanup and records normal provider usage in PostgreSQL.

`npm run verify:voice:browser` additionally checks the app's voice/text context,
automatic turns, echo rejection, returning to listening, resuming context, microphone
denial, and a controlled service failure. Install frontend dependencies first
and use an installed Google Chrome, or set `PADI_VOICE_BROWSER_EXECUTABLE` to a
compatible Chromium executable. The browser uses isolated test storage and
public/synthetic speech; it never opens a personal microphone. These commands
require the configured development environment and confirmed free accounts.

Internal endpoints:

- `GET /health`: service liveness and separate local-model readiness, without user content.
- `GET /ready`: 200 when an installed local model is loaded; 503 otherwise.
- `POST /transcribe`: token-protected multipart audio from Go. Voice detection,
  actual container/codec validation, decoding, 16 kHz mono preparation and local faster-whisper recognition.
- `POST /cancel`: internal-token-protected cancellation, scoped to Go's request ID and authenticated user.
- `POST /synthesise`: token-protected text/style/rate/language from Go. Gemini returns
  actual speech audio; Python validates and wraps it as playable mono WAV.

No CORS access is granted directly to apps, and user-facing APIs remain in Go.
There are no mock transcripts or simulated speech. Audio/text/credentials are
not logged or persisted. Inputs and responses are bounded and provider errors
are sanitised. The standard-library server is intended behind Go's private
boundary, not as a public unauthenticated endpoint.

## Uploaded recordings and Faster-Whisper

Open **Voice → Voice to text** in PADI. This mode records and displays recognised
words without submitting them to chat or requesting TTS. Existing voice
conversations, voice profiles, speech delivery instructions and playback remain
available through **Voice conversation**. Native microphone modules are unchanged.

```sh
npm run setup:voice
services/voice/.venv/bin/python services/voice/install_model.py --model base
```

The installer downloads only the selected public CTranslate2 checkpoint, pins
its registry revision and prints its actual download size and local directory.
It runs only when explicitly invoked. Models are ignored by Git; application
startup and recognition use local files only and never download or fall back to
an external transcription API. Install into durable storage in production and
set `PADI_STT_MODEL_PATH` to that directory. The base model binary is approximately
139 MiB; the complete local checkpoint is approximately 141 MiB. Tiny is about
75 MiB including its tokenizer. Runtime memory is additional to model storage.

Enable `PADI_STT_ENABLED=true` in `backend/.env`. Configure the existing
`PADI_VOICE_SERVICE_TOKEN` with a random secret of at least 32 characters.
Incoming recognition needs no Gemini/Groq key. `PADI_PYTHON_VOICE_ENABLED` remains
the existing outgoing-speech setting and retains its existing requirements.
The internal service defaults to loopback port 8090. For a separate host, place
Python behind a private HTTPS proxy; Go rejects credential-bearing URLs and redirects.

`PADI_STT_MODEL` accepts `tiny`, `base` or `small`; `PADI_STT_MODEL_PATH` can point
to a separately installed compatible checkpoint. Defaults: CPU `int8`, one
persistent worker, two CPU threads, 120-second processing timeout. Worker count
is configurable from 1 to 4; each worker loads its own model. Increase capacity
only after measuring CPU and memory on the actual deployment. No GPU is assumed.

The inspected development hardware has two Celeron J4005 CPU cores, about
7.5 GiB RAM and no detected GPU or AVX2. Base was selected after actual tiny/base
comparisons: base preserved the short Nigerian English fixture exactly, while
tiny split “Invoices” into “In voices”. This CPU is slow for recognition. Nigerian
Pidgin remains substantially less accurate than clear English; a selected Pidgin
mode preserves the existing recognition hint and uses Whisper's English tokens.
The Igbo choice preserves its existing vocabulary hint with automatic detection,
since Whisper has no native Igbo code. These choices do not establish reliable
recognition across Nigerian languages or dialects. Text is never corrected or
polished after recognition. Automatic language detection and explicit selections
remain available; returned language confidence is not transcription accuracy.

Browser capture requests a 16 kHz mono audio engine and preserves microphone
AEC, noise suppression and gain control. A bounded AudioWorklet resamples PCM
metering/VAD frames if the engine ignores or rejects 16 kHz. MediaRecorder
compresses the source before upload, preferring WebM/Opus at a requested 32 kbps.
Opus may internally use 48 kHz; Python decodes/resamples once to 16 kHz mono.
If WebM/Opus is unavailable, supported M4A/AAC is accurately identified. There
is no uncompressed WAV fallback in this new browser recorder. Legacy/native PCM
WAV and native AAC uploads remain supported by Go/Python.

Go authenticates before reading bounded multipart input, verifies content type
against container bytes and forwards the same compressed bytes without transcoding.
Python verifies complete WebM/MP4 framing (including streaming WebM), checks the
actual codec and audio stream count, rejects overlong/silent/corrupt inputs and
prepares 16-bit mono PCM. The existing 80 Hz rumble filter, 20 ms WebRTC VAD and
500 ms trim margins are retained. Whisper receives a 16 kHz mono float32 waveform.
Decoder external-file references and network protocols are disabled.

Safety protections are always active for this incoming flow: authentication,
8 MiB audio ceiling, 60-second server duration limit, bounded upload/processing
concurrency and timeouts. The browser normally stops at 59 seconds to leave
encoder finalisation headroom. Go allows 60 seconds for the browser upload and
130 seconds for the Python round trip; the app request deadline is 200 seconds.
The private Go-to-Python body gets a ten-second deadline. Busy capacity returns
429 immediately rather than queuing unlimited work. Existing application/provider
quotas and cooldown settings are untouched. No new application limit-management
system is needed or enabled; existing safety gates are separate from quotas.

Cancellation aborts capture/upload, propagates through Go's request context and
an authenticated request/user cancellation message, and terminates/reaps an
isolated inference process before reusing its capacity. The library's active
native inference is not safely interrupted in a Python thread. Cancellation
therefore reloads that worker's model; readiness can briefly be false. If OS
termination cannot be confirmed, that worker is quarantined instead of replaced.
Python's `/cancel` response acknowledges a request, not completion of inference
cleanup. Temporary audio is removed after processing/cleanup. No recordings or
transcripts are retained for analytics or stored in PostgreSQL.

**Audio details** displays actual Blob bytes, counted captured PCM frame bytes,
validated codec/container/duration, decoded PCM bytes, upload/decoding/preparation/
recognition timings and total time after Stop. Savings compare uploaded container
bytes with actual decoded 16 kHz PCM bytes; this is not a measurement of complete
HTTP/TLS/network packet overhead. Compression finalisation measures stop/flush,
not the ongoing encoder's CPU time. No private speech is logged.

Verify the permanent incoming route separately from AI/outgoing speech:

```sh
npm --prefix frontend test
npm --prefix frontend run typecheck
services/voice/.venv/bin/python -m unittest discover -s services/voice -v
npm run verify:transcription
services/voice/.venv/bin/python services/voice/evaluate_recognition.py --models base --compare-wav
```

The browser command needs a usable development PostgreSQL database, an installed
checkpoint, frontend dependencies and Chromium. It creates and deletes a synthetic
account, exports the real PADI app, uses public prerecorded speech as the microphone
and checks actual Opus → authenticated Go → Python → local recognition → displayed
text. It does not use AI or TTS providers. Normal unit runs explicitly skip the
opt-in browser test; missing checkpoints explicitly skip the real-model unit test.
Do not report those skipped checks as executed. See
[the verification report](../../docs/incoming-voice-verification.md) for observed
accuracy, compression, test results and deployment requirements.

## Device verification

Foreground voice on Android and iOS needs a development build containing the
native capture module. Verify acoustic echo rejection, first audible speech,
continuous playback and interruption on physical phones. The current
[conversation protocol and timing guide](../../docs/live-voice-conversation.md)
covers the local neural speech path.
