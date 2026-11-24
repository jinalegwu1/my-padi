# Live voice conversation

The voice screen contains PADI's picture, an exit control, and a switch to text.
It has no welcome copy, status labels, transcript cards, or recording/submission
buttons. Opening the screen waits for a picture tap. That tap requests microphone
permission, plays a cached spoken greeting, and automatically starts listening.
Permission denial appears as an error and does not play a greeting or start a turn.
Browser capture uses the existing AudioWorklet and voice-activity detector.
It keeps short 16 kHz PCM frames on
the device, groups them into utterances, and uploads each completed utterance
through the authenticated Go API to the existing local Faster-Whisper service.

## Speech recognition limitation

The Python recognition service currently exposes a multipart `POST
/transcribe` endpoint for complete audio files. It does not accept a live audio
stream or independent codec fragments. The browser therefore waits for the
voice-activity boundary (1.4 seconds of quiet, with a bounded utterance)
before uploading that utterance. This is incremental per utterance, not
continuous server-side transcription; recent audio remains on-device until
that boundary. Each completed utterance goes to Groq as soon as recognition
finishes, including speech without sentence punctuation. Silence completes
only the listening turn; there is no conversation inactivity timeout.

## Conversation and speech output

Voice requests use the authenticated `/v1/chat` SSE mode. The backend accepts
that mode only when the configured fast model is Groq's
`openai/gpt-oss-20b`; it streams Groq deltas and never uses the ordinary chat
provider or its fallback route. API credentials remain in the Go/Python
services. Text chat continues to use the existing JSON endpoint and routing.

The client saves streamed text in shared chat and sends completed sentences
to the existing synthesis service while later response text is still arriving.
Voice replies and the spoken greeting use the existing Groq Orpheus model only.
They do not select Gemini or spend Gemini speech quota. English variants and
Nigerian Pidgin at normal speed are supported; unsupported settings report a
clear error. Ordinary text-chat providers, routing, and speech remain separate.
The first usable sentence or a bounded phrase starts TTS immediately. Two
synthesis requests can prepare ahead of playback; text waiting for a slot is
combined into coherent passages. Audio is decoded before its scheduled slot.
Web Audio uses one context and an audio-clock timeline; updated native modules
keep their player/streaming AudioTrack for the response. Only outer provider
silence is trimmed, with margins around voiced samples. No timer inserts gaps.

The microphone stays active while PADI speaks. Device echo cancellation is
supplemented with the actual playback PCM reference, delayed full-band matching,
and a short filter for resampling differences. Genuine speech onset (120 ms of
voiced audio) immediately aborts generation, synthesis and scheduled playback,
detaches the old response, and keeps recording the new user turn. Late old
callbacks cannot reset its detector or restart audio. A 700 ms pause stays
inside the same thought; 1.4 seconds of silence completes the turn. A bare
"Stop" is handled locally after recognition. Natural completion returns to
listening without closing capture. Exiting cancels both input and output;
confirmed text/voice history remains in the shared conversation.

## Verification

Focused verification:

- `node scripts/verify-voice-playback.mjs --baseline` measured the former
  sentence-by-sentence flow: 3.2–3.6 second gaps and a 2.28 second delay from
  the first text delta to audio. TTS started before stream completion, but the
  authenticated TTS round trip finished later. Provider generation itself took
  roughly 0.7–1.0 seconds; authentication/usage requests added further latency.
- `node scripts/verify-voice-playback.mjs` records real Groq speech in Chromium
  and checks audio scheduling, full text/spoken delivery, natural completion,
  echo rejection, and exit. A deliberately slower SSE fixture separately checks
  early real-audio playback; the live Groq stream can finish before TTS returns.
- `node scripts/verify-voice-playback.mjs --interruptions` uses actual recorded
  speech for all seven interruption/turn scenarios. Stop and the new question
  pass through real Faster-Whisper; scripted responses/transcripts make the
  other stress cases repeatable. Stop interrupted at 356 ms, the new question
  at 175 ms, and repeated interruptions at 187–189 ms. The brief pause remained
  one turn; old audio did not restart; natural completion resumed listening.

The Android voice module compiles. iOS compilation and physical microphones,
speakerphone/Bluetooth echo paths, and native responsiveness still require
device testing. Browser recordings are software audio evidence, not a claim
that those hardware configurations were tested.

Final checks for this revision: 42 focused capture, echo, session, synthesis,
and playback tests passed; TypeScript and Android Kotlin compilation passed.
The live Groq browser recording had zero scheduled gaps/overlap between its
three prepared clips and preserved/spoke the complete six-sentence response.
First audio began 3.12 seconds after the first delta. That live Groq response
completed before its first TTS round trip; early audio before stream completion
was verified separately with the slower SSE fixture. The server/TTS first-audio
latency has not been eliminated.

## Files in the playback/interruption revision

Production changes:

- `frontend/src/hooks/use-voice-session.ts`: strict Groq voice stream and echo-filter wiring.
- `frontend/src/lib/handsfree-session.ts`: streaming queue, speech interruption, turn ownership and Stop handling.
- `frontend/src/lib/streaming-speech.ts`: bounded synthesis lookahead, ordered audio submission and outer-padding trimming.
- `frontend/src/lib/voice-echo.ts`: playback PCM reference, full-band alignment and residual echo filtering.
- `frontend/src/lib/voice-activity.ts`: configurable speech-onset/end-of-turn thresholds and residual voice levels.
- `frontend/src/lib/voice-capture.web.ts`: device audio clock with unchanged 16 kHz PCM output.
- `frontend/src/lib/voice-audio.ts`: usable first-phrase extraction.
- `frontend/src/lib/voice-playback.web.ts`: one output timeline, advance decoding and exact buffer scheduling.
- `frontend/src/lib/voice-playback.ts`: native queued playback and cancellation.
- `frontend/modules/padi-voice/ios/PadiVoiceModule.swift`: queued buffers on the existing player.
- `frontend/modules/padi-voice/android/src/main/java/expo/modules/padivoice/PadiVoiceModule.kt`: one streaming AudioTrack per response.

Verification changes: `scripts/verify-voice-playback.mjs`, the focused
`voice-playback-browser.cjs` and `voice-interruption-browser.cjs` checks, new
`streaming-speech.test.cjs` and `voice-echo.test.cjs` cases, and updates to
`handsfree.test.cjs`, `voice-session-hook.test.cjs`, `voice-capture.test.cjs`,
`voice-capture-browser.cjs`, `voice-playback.test.cjs`, and `voice-browser.cjs`.
Documentation changed in this file, the root README, and the voice-service
README. The ordinary text-chat provider/routing and Groq conversation model
were not changed by this revision.

Before this playback/interruption revision on 24 November 2026, all 150 frontend tests, TypeScript checking, Go AI/API/voice
tests, and the live browser check passed. The browser completed successive
voice turns, reopened the conversation with context, and played real fallback
TTS during a controlled fast-speech outage. It also verified permission denial,
recognition failure, and stopping both capture and playback when leaving.
The measured first spoken reply began 31.66 seconds after input ended; local
base-model recognition took roughly 20–25 seconds per turn on this machine.

Local verification setup installed the missing Faster-Whisper base checkpoint,
created the frontend's public API URL setting, and aligned the development
Gemini model entry with its existing approved-model list. Model files and local
environment files remain excluded from version control.
