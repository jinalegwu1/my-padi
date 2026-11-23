# Incoming PADI voice verification — 2026-11-23

The permanent feature is available inside PADI at **Voice → Voice to text**.
It records complete compressed segments and displays the local recogniser's
words. Existing voice conversations remain available. The incoming-only mode
never submits its transcript to AI or requests speech generation.

## Actual integration

1. `frontend/src/app/voice.tsx` selects the new integrated screen.
2. `use-transcription-session.ts` and `transcription-session.ts` manage one
   account-scoped recording/upload with cancellation and stale-result guards.
3. `voice-capture.web.ts` requests a mono 16 kHz audio engine, preserves AEC,
   noise suppression and gain control, and safely resamples metering/VAD PCM
   when that rate is unavailable. Existing VAD/silence timings are unchanged.
4. `recording.web.ts` compresses in the browser with MediaRecorder, preferring
   WebM/Opus at a requested 32 kbps. Supported AAC/M4A is accurately labelled;
   there is no uncompressed WAV fallback in this new recorder.
5. `api.ts` uploads the actual Blob as authenticated multipart to Go, measures
   transport upload progress and validates the structured response.
6. `backend/internal/httpapi/voice.go` authenticates, limits multipart size and
   concurrency, checks media types/container bytes and assigns user/request IDs.
7. `backend/internal/voice/transcriber.go` forwards identical compressed bytes
   to private Python with its internal token, without transcoding or a second
   full multipart audio copy. Cancellation reaches the upstream request and
   an authenticated cancellation message scoped to that user/request.
8. Python's `transcription_http.py` creates a safe request-scoped temporary file;
   `audio_containers.py` checks complete WebM/MP4 framing; `audio_processing.py`
   checks codec/stream count, decodes and produces mono 16 kHz PCM. The existing
   80 Hz rumble filter, 20 ms WebRTC VAD and 500 ms trim margins are retained.
9. `local_recognition.py` runs actual faster-whisper inference on a 16 kHz
   float32 waveform and returns text, language and measured processing metadata.
10. Go validates identity/metadata and PADI displays that exact returned text.

No transcript database table was added. No audio/transcript is retained for
analytics. HTTP responses disallow caching. Error details are sanitised, and
private content is not logged. Actual tests confirm temporary file cleanup,
account binding and rejection of another account's response. Inference is
isolated in persistent processes: cancellation/timeout terminates and reaps a
worker before replacing it. A worker whose termination cannot be confirmed is
quarantined. `/cancel` acknowledges a request; the tests separately check cleanup.

## Engine, model and installation

Engine: faster-whisper 1.2.1, CTranslate2 4.6.0 CPU `int8`, PyAV 16.0.1 and
NumPy 2.2.6, with WebRTC VAD 2.0.14. No external transcription API or fallback.

Selected default: multilingual **base**, one persistent worker, two CPU threads.
The actual machine has two Intel Celeron J4005 cores, about 7.5 GiB total RAM,
no AVX2 and no detected GPU. Both base and tiny were installed and evaluated;
base was selected for better observed Nigerian English accuracy. Base's model
binary is 145,217,532 bytes (about 139 MiB); the complete checkpoint is about
141 MiB. Tiny's complete download was 74.6 MiB. Runtime RAM is additional.

```sh
npm run setup:voice
services/voice/.venv/bin/python services/voice/install_model.py --model base
```

The explicit installer reports size/directory, pins a registry revision and
stores only selected model/tokenizer files under ignored `services/voice/models`.
The service never downloads models at startup or per request. Set
`PADI_STT_MODEL_PATH` to a durable installed checkpoint in production.
`PADI_STT_MODEL` supports tiny/base/small. Worker count, threads and timeout are
configurable; defaults are 1, 2 and 120 seconds. A compatible custom checkpoint
can be supplied through the model path. `GET /health` reports service liveness;
`GET /ready` separately reports model readiness. Startup failure produces a
clear unready state rather than placeholder text.

Automatic language detection and explicit English/Pidgin choices are supported.
Whisper has no native Pidgin/Igbo code: Pidgin uses English tokens with the
existing fixed recognition hint; Igbo retains its existing hint with automatic
detection. Output is never polished or corrected afterwards. Language confidence
is not transcription accuracy.

## Tests actually executed

| Check | Actual result |
| --- | --- |
| Frontend `npm --prefix frontend test` after fixes | 130 passed, 0 failed, 0 skipped |
| Frontend `npm --prefix frontend run typecheck` | Passed |
| Python `python -m unittest discover -s services/voice -v` | 39 passed, 0 failed, including actual local Whisper recognition of real Opus-encoded speech |
| Go `go test ./... -json` with isolated PostgreSQL | 344 test/subtest passes, 0 failures; 4 explicit opt-in tests skipped |
| Full `TestIncomingTranscriptionBrowser` | Passed in 484.98 seconds, using the exported PADI app, Chromium MediaRecorder, real PostgreSQL authentication, production Go route and actual Python/Whisper |
| Browser compatibility/capture script | Passed: 9 actual PCM upload comparisons, direct 16 kHz, rejected/ignored rate options, source attachment fallback, denial and cleanup |
| Python dependency consistency (`pip check`) | No broken requirements |
| `git diff --check` | Passed |

The full incoming browser test includes seven speech cases, repeat recording,
permission denial, unsupported compression detected before permission, silent
recording rejection, navigation microphone shutdown, useful Python decode errors
and cancellation of actual processing across browser → Go → Python. Browser
encoder byte totals exactly matched Python's received audio byte count. No AI/TTS
request was made by the incoming feature. Noise/silence variants were generated
from public recordings and removed after testing.

The four default Go skips were `TestPersonalMemoryLiveAI`,
`TestIncomingTranscriptionBrowser`, `TestHandsfreeBrowser` and
`TestVoiceLiveTranscriptionAndChat`. The incoming browser test was executed
separately and passed; the unrelated live AI/outgoing-voice checks were not run.
Native recording/cancellation unit tests passed. Physical Android/iPhone
microphones and Safari/Firefox devices were not manually tested.

Initial failures were investigated and fixed or isolated: the sandbox disallowed
local sockets, an expected VAD-tail test was too strict, existing notification
unit mocks were stale, and installed Expo dependencies differed from the
repository lockfile. `npm ci` restored the locked Expo 57/asset 57 packages;
no frontend framework or dependency versions in the lockfile were changed.
FFmpeg accepted truncated WebM by itself, so complete framing validation was
implemented and corrupted-tail tests now pass.

## Actual browser measurements and recognised words

These are real Chromium microphone/Opus/Go/Python/display results, using the
published reference words in `frontend/tests/fixtures/transcription.json`.
Decoded PCM includes recorded silence. Savings compare actual uploaded container
bytes with actual decoded 16 kHz mono PCM bytes, not estimated network usage.
HTTP/TLS/packet overhead is not included. Total after Stop includes upload,
processing, reply delivery and UI cleanup. Browser recording duration is reported
from actual decoded samples. Compression finalisation measures stop/flush rather
than the ongoing encoder's CPU time.

| Fixture | Duration | PCM bytes | Opus upload bytes | Saving | Decode | Recognition | Total after Stop | Word error rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clear-english | 12.78s | 408,960 | 45,764 | 88.81% | 0.36s | 41.50s | 43.21s | 4.5% |
| short-sentence | 3.00s | 96,000 | 7,591 | 92.09% | 0.07s | 25.23s | 26.34s | 0.0% |
| nigerian-english-short | 7.50s | 240,000 | 22,509 | 90.62% | 0.18s | 18.05s | 19.20s | 0.0% |
| nigerian-english-long | 9.30s | 297,600 | 29,751 | 90.00% | 0.50s | 25.24s | 27.20s | 22.2% |
| nigerian-pidgin | 10.02s | 320,640 | 34,822 | 89.14% | 0.16s | 20.29s | 21.45s | 50.0% |
| speech-with-silence | 9.48s | 303,360 | 24,866 | 91.80% | 0.21s | 16.27s | 17.60s | 0.0% |
| noisy-speech | 7.50s | 240,000 | 25,435 | 89.40% | 0.15s | 21.70s | 22.90s | 12.5% |

Examples are the unmodified recogniser output:

- **clear-english**: “And so my fellow American, ask not what your country can do for you, ask what you can do for your country.” (1/22 word errors against the published reference).
- **short-sentence**: “Please continue.” (0/2 word errors against the published reference).
- **nigerian-english-short**: “Invoices are always issued with terms of payment.” (0/8 word errors against the published reference).
- **nigerian-english-long**: “Ninja Delta is sometimes called the oil reverse because it was once a major producer of pomoid.” (4/18 word errors against the published reference).
- **nigerian-pidgin**: “If you want to done one, now you sabi. But make sure you say you de-monitor your pe-kin wear wear.” (10/20 word errors against the published reference).
- **speech-with-silence**: “Invoices are always issued with terms of payment.” (0/8 word errors against the published reference).
- **noisy-speech**: “Invoices are always issued with terms of penance.” (1/8 word errors against the published reference).

The short Nigerian English clip and speech with silence matched exactly.
The longer clip confused “Niger”, “Rivers” and “palm oil”; Pidgin accuracy was
poor. The noisy sample changed “payment” to “penance”. These failures remain
visible to the user rather than being disguised by invented corrections.

Word error rate counts insertions/deletions/substitutions after normalising
case and punctuation. It is a limited fixture comparison, not a claim about
all Nigerian speakers or dialects. Pidgin orthography can also affect scoring.
The generic local base model is not sufficiently reliable for all Pidgin speech;
a better local dialect checkpoint and a wider consented evaluation set remain
important future work. HTTP 200 alone is not an accuracy test.

Independent real WAV/Opus engine comparisons found equal recognised words for
both Nigerian English fixtures, while Pidgin wording changed. Tiny's Opus word
error rates were 25.0% (short Nigerian English) and 27.8% (longer); base achieved
0.0% and 22.2% on those same files. Tiny recognition took about 6.5–8.2 seconds;
base about 12.3–17.1 seconds in that comparison. The complete browser run was
slower. This non-AVX2 CPU does not meet a five-second conversational target.

For the same ten-second generated waveform, actual browser WAV upload sizes
were 882,044 bytes at 44.1 kHz, 960,044 at 48 kHz and 320,044 at 16 kHz: 63.72%
and 66.66% reductions. Opus provides additional compression in the new incoming
mode. Original captured PCM frame byte counts are also measured on-device;
no full uncompressed recording is stored merely for analytics.

## Deployment and remaining requirements

- Keep an installed model on durable local storage and configure the internal
  service token (at least 32 random characters) and `PADI_STT_ENABLED=true`.
  Defaults remain opt-in/off. Incoming recognition needs no Gemini/Groq key.
- Correct the existing `DATABASE_URL` / `PADI_TEST_DATABASE_URL` in `backend/.env`
  before using ordinary application accounts: their configured hostnames were
  incomplete. No credentials were guessed or changed. Verification used a
  temporary, SCRAM-protected loopback PostgreSQL 16.16.0 instance and the
  repository's existing migrations/authentication. Synthetic account data was
  deleted. The temporary runtime/database are test infrastructure, not a new
  product datastore or application.
- Run Python on loopback with Go, or behind a private HTTPS proxy; allow the
  configured long request deadlines. Uploads are limited to 8 MiB/60 seconds,
  and the recorder stops at 59 seconds for finalisation headroom. Auth, size,
  concurrency and decoder protections remain active even when an existing
  application quota-bypass setting is enabled.
- Benchmark production CPU/memory and model accuracy before increasing workers.
  Cancellation reloads an isolated model worker, so readiness can briefly drop.
- Real physical mobile/browser-device verification and better Pidgin accuracy
  remain outstanding. Existing Android/iOS microphone implementations and
  outgoing PADI voice identity, profiles, emotional delivery, pacing and tuning
  were not edited. AST comparison confirmed all five outgoing Python synthesis
  payload/audio functions unchanged.

No new quota-management system was introduced or enabled. Existing provider
quotas, cooldown settings, AI routing and device-TTS behaviour are unchanged.

## Exact files

### Created

- `backend/internal/httpapi/transcription_e2e_test.go`
- `backend/internal/httpapi/transcription_test.go`
- `docs/incoming-voice-verification.md`
- `frontend/src/components/voice/transcription-screen.tsx`
- `frontend/src/hooks/use-transcription-session.ts`
- `frontend/src/lib/transcription-session.ts`
- `frontend/tests/fixtures/clear-english.wav`
- `frontend/tests/fixtures/nigerian-english-long.wav`
- `frontend/tests/fixtures/nigerian-english-short.wav`
- `frontend/tests/fixtures/nigerian-pidgin.wav`
- `frontend/tests/fixtures/transcription.json`
- `frontend/tests/helpers/voice-capture.cjs`
- `frontend/tests/transcription-browser.cjs`
- `frontend/tests/transcription-session.test.cjs`
- `frontend/tests/voice-capture-browser.cjs`
- `frontend/tests/voice-capture.test.cjs`
- `scripts/verify-transcription.mjs`
- `scripts/verify-voice-capture-recognition.mjs`
- `services/voice/audio_containers.py`
- `services/voice/audio_processing.py`
- `services/voice/evaluate_recognition.py`
- `services/voice/install_model.py`
- `services/voice/local_recognition.py`
- `services/voice/test_incoming_voice.py`
- `services/voice/transcription_http.py`
- `services/voice/voice_errors.py`

### Modified

- `backend/.env.example`
- `backend/cmd/api/main.go`
- `backend/internal/httpapi/voice.go`
- `backend/internal/httpapi/voice_test.go`
- `backend/internal/voice/silence_test.go`
- `backend/internal/voice/transcriber.go`
- `backend/internal/voice/transcriber_test.go`
- `frontend/src/app/voice.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/recording.web.ts`
- `frontend/src/lib/voice-capture.web.ts`
- `frontend/tests/check-in-state.test.cjs`
- `frontend/tests/device-actions.test.cjs`
- `frontend/tests/fixtures/README.md`
- `frontend/tests/push-device-lifecycle.test.cjs`
- `frontend/tests/recording.test.cjs`
- `package.json`
- `scripts/dev.mjs`
- `scripts/setup-voice.mjs`
- `services/voice/.gitignore`
- `services/voice/README.md`
- `services/voice/app.py`
- `services/voice/requirements.txt`
- `services/voice/test_voice.py`

