# Phase 1 correction and voice text-model architecture

Status: **implemented, not accepted as complete**. Gemini 3.1 Flash-Lite remains unavailable in live generation checks, and personality quality still needs product review. This report separates actual reproduction, automated checks, and externally blocked acceptance.

## Confirmed causes and corrections

### “Stop” became “Start”

Reproduced with the real microphone worklet, playback echo, and local Faster-Whisper. The same recognition model repeatedly returned `Stop.` for the original WAV and `Start.` for the captured failure WAV. Aligning the files showed that the onset/consonant windows were altered during double talk: representative 50 ms windows retained about 38–63% of the source amplitude, while the later vowel matched almost exactly. The echo suppressor accepted correlation scores as low as 0.35 and fitted/subtracted a waveform that could include genuine user consonants.

The suppressor now requires a strong positive correlation before modifying PCM. Weak or uncertain matches pass through unchanged, allowing genuine onset to cancel playback. High-confidence echo retains the far-end filter; it does not blanket-mute the microphone. Bare `Start` is not interpreted as permission to restart playback: PADI stays listening and asks what to start. Stop/speaking commands stop the reply, while explicit end/hang-up commands close voice mode. Transcriptions are never silently rewritten from Start to Stop.

### Speaker audio created an unexpected user turn

Reproduced in stress checks, including an unintended captured turn recognised offline as `Great.` with no corresponding injected user speech. The far-end reference was aligned using the output position at JavaScript callback time, while microphone worklet frames could be queued behind decoding, speech-envelope preparation, and echo processing. The old alignment searched only a bounded recent window and could miss the actual captured sample. In addition, reference/microphone resampling filters differed, and sparse matching could choose a pitch-period alias that left speaker residual above the VAD threshold.

Browser microphone frames now carry their capture sample time, including the AudioContext offset when the worklet starts. Echo alignment subtracts actual delivery age instead of treating every callback as current audio. Reference conversion matches the microphone filter. A verified delay is tracked at full sample resolution before reacquiring a broader match; only a very strong echo match with a tiny residual is suppressed entirely. Debug measurements are opt-in, development-only numeric data, without audio/text recording in product use.

### Context disappeared after a partial interruption

Inspection found that partially streamed assistant replies were stored with `backendChat: false`, so the next context builder excluded them. Their associated user turns also lacked committed context metadata. Partial exchanges now retain account ownership, the request's memory revision, the interruption flag, and the completed spoken prefix. Server memory-revision validation still discards stale context. A focused test interrupts midstream, resumes, and verifies the exact supplied context and spoken prefix.

### Personality and preference conflicts

The previous system prompt instructed the model to be witty even on humour-off turns; spoken application context also explicitly requested a “witty identity.” A prohibition later in the prompt competed with those instructions. The shared instruction builder now adds humour expression only when the existing assessment permits it. Humour-off/serious turns receive warmth and interest plus a clear no-joke boundary, without competing comedy instructions. A direct joke request no longer bypasses a saved humour-off setting. The voice context follows the selected preference.

Greeting instructions previously demanded wit in the first line and primed dramatic entrances. They now request an ordinary, warm hello with optional wit. Existing opening-word variation and validated returning context remain. Teasing guidance asks for a concise comeback built on the user's premise, not an apology or service acknowledgement. Grief, explicit seriousness, distress, consent-based learning, and saved preferences retain precedence. A mixed statement about a dead phone and an actual bereavement no longer hides the bereavement.

## Voice model architecture

Google's authenticated live catalogue returned both `models/gemini-3.1-flash-lite` and its preview variant. The stable identifier `gemini-3.1-flash-lite` is used; no model name was invented.

Current local voice configuration:

| Stage | Configured model | Purpose |
| --- | --- | --- |
| Voice primary text | Gemini `gemini-3.1-flash-lite` (`gemini-voice`) | Generate conversational text |
| Voice backup text | Groq `openai/gpt-oss-20b` (`groq-fast`) | Generate conversational text |
| Existing voice TTS | Groq `canopylabs/orpheus-v1-english` | Convert either model's text to speech |
| Recognition | Local Faster-Whisper `base` | Transcribe user utterances |

`PADI_AI_VOICE_PRIMARY_MODEL` and `PADI_AI_VOICE_BACKUP_MODEL` are optional independent routes. Empty values retain the existing primary → fast order. Ordinary text-chat routing is unchanged: its configured Gemini `gemini-3.5-flash-lite` primary, Groq fast route, Z.ai reasoning route, and OpenRouter backup remain as before. The existing synthesis provider/configuration is unchanged.

The Gemini adapter calls `streamGenerateContent` with `responseModalities: ["TEXT"]`. It rejects unexpected inline audio and withholds thought parts. Both adapters deliver the same SSE delta/done format to the existing speech queue. Gemini is not used for TTS in this voice path. The legacy readiness names remain for client compatibility.

Fallback is allowed on retryable failure, circuit-open, or budget rejection **before the first text delta**. Once text may have reached speech playback, an error cancels that response; a different model cannot append an unrelated continuation. Cancellation never starts a fallback request. Routing and usage accounting remain in Go.

## Actual verification results

- `cd backend && go test ./...`: PASS after the new configuration fixture was corrected; external live tests remain explicitly opt-in.
- Focused frontend checks for greetings, chat/context, API, preference loading, hands-free turns, streaming speech, echo, capture/resampling, cancellation, and playback: 83 passed, 0 failed in the final consolidated run.
- `npm run typecheck`: PASS.
- Three successful real-audio stress runs, each with 15 repeated interruptions plus Stop, a new question, a 700 ms intra-turn pause, complete-thought response, and natural completion. Stop and the new question used real Faster-Whisper; reply text was controlled for repeatability, with actual previously generated Groq speech audio. All three runs recognised `Stop.`, rejected echo-only turns, kept context, and returned to listening. Run durations were 162.52 s, 155.96 s, and 160.43 s. Measured onset-to-stop latency across these runs ranged from 59 to 380 ms.
- Intermediate runs failed and are not counted as passes. They exposed weak-match corruption, queued-frame alignment, a missing AudioContext offset during the timestamp change, audit timing races, and 30-second test waits expiring during concurrent Whisper inference. The final three stress passes are preserved separately in the evidence JSON.
- Real Groq text → existing speech endpoint: PASS, response `Our project is called PADI.`, HTTP 200 TTS, playable WAV of 122,916 bytes.
- Controlled Gemini 503 → **real Groq text** → existing speech endpoint: PASS in 11.37 s. Observer evidence confirms attempted Gemini then successful Groq, preserved context, HTTP 200 TTS, and the same 122,916-byte speech format. Only the primary failure was simulated.
- Real Gemini 3.1 text → TTS: **NOT VERIFIED**. Catalogue lookup succeeded, but repeated stable/preview stream attempts and ordinary `generateContent` returned HTTP 503 `UNAVAILABLE`, explicitly reporting high demand. No Gemini-generated response was passed off as a successful result.
- Groq intermittent failures were diagnosed as rolling daily token allowance exhaustion: provider error reported 198,639 of 200,000 tokens used and a request needing 1,617 tokens; the minimal prompt could succeed while the full personality prompt was rejected. Later real Groq and fallback tests passed as allowance replenished. Production limits were not bypassed or changed.
- Actual text greeting before correction: dramatic “digital doorstep/magnificent chaos.” After: `Hey there, good to see you! What's been keeping you busy today?` and `Good to have you here today. What's been on your mind lately?` The subsequent voice greeting attempt was provider-blocked and is not a passed greeting test.
- Seven real, context-preserving text conversations completed (242.72 s): everyday chat, user joke, teasing, sarcasm, two humour-off cases, and grief. Teasing produced `Fair hit. Even the tea is looking at me like, "Are we doing this today or what?"` instead of a service acknowledgement. Grief produced `I am so, so sorry. I am right here with you. Take all the time and space you need.` Humour-off cases avoided deliberate punchlines, though figurative warmth remains and needs taste review. Some humour still feels elaborated rather than effortless; this is not full product acceptance.

Actual responses and sanitized model/latency evidence: [phase1-correction-evidence.json](phase1-correction-evidence.json).

## Exact files touched in this correction

Production/configuration:

- `backend/.env` (local, ignored: added verified voice model and independent voice route)
- `backend/.env.example`
- `backend/internal/ai/config.go`, `types.go`, `router.go`, `instructions.go`, `provider_gemini_stream.go`, `evaluation.go`
- `backend/internal/httpapi/auth_chat.go`
- `backend/internal/personality/personality.go`
- `frontend/src/lib/greeting.ts`, `voice-activity.ts`, `voice-capture.web.ts`, `voice-echo.ts`, `handsfree-session.ts`
- `frontend/src/state/chat-context.tsx`

Verification/documentation:

- `backend/internal/ai/config_test.go`, `instructions_test.go`, `router_test.go`, `voice_routing_test.go`
- `backend/internal/httpapi/personality_foundation_test.go`, `voice_models_live_test.go`
- `backend/internal/personality/personality_test.go`
- `frontend/tests/chat-state.test.cjs`, `handsfree.test.cjs`, `personality-browser.cjs`, `voice-capture.test.cjs`, `voice-echo.test.cjs`, `voice-interruption-browser.cjs`
- `frontend/tests/helpers/voice-capture.cjs`
- `scripts/verify-personality.mjs`, `verify-voice-playback.mjs`, `verify-voice-models.mjs`
- `docs/live-voice-conversation.md`, this report, and `phase1-correction-evidence.json`

Some files became part of the user's `a6474b8` commit during this work. This list covers the whole correction, not only the final uncommitted diff. No user changes were reset or discarded.

## Remaining acceptance limits

Gemini catalogue availability is not proof of usable generation: the real Gemini text path still needs a successful response and the same TTS/playback verification. Voice/text personality equivalence and consistent humour-off behaviour need fresh real responses from both routes once providers recover. Humour quality is improved in the recorded text samples, not proven universally. Native microphone events do not yet expose browser-style sample timestamps; physical Android/iOS echo behaviour and human listening quality were not verified. No new TTS engine or artificial nonverbal laughter was introduced.
