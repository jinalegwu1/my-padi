# PADI signature voice and forest-green chat

The engine measurements below were recorded on 27 November 2026 on the signature-voice branch. The current entry points are `/chat?mode=text` and `/voice`.

## Stage 1 — Existing architecture

The Python service loads the configured engine and recognizers at startup.
In local mode, Nigerian English and Pidgin use the two pinned Uphando VITS
checkpoints. PADI’s `baby` profile originally selected the male checkpoint.
Other installed output locales use eSpeak NG. The service also has separately
configured Gemini and Groq speech integrations.

The app sends microphone frames through device echo cancellation, a playback
reference and speech detection. Authenticated Go forwards live PCM to Vosk.
Completed recordings use Faster-Whisper. Go streams the chat model's reply and
forwards synthesis requests to Python. Python returns 24 kHz mono WAV packets
that the host queues for playback. The microphone stays open during a call and
new speech cancels queued output. Python supplies personality guidance.

Inspection and baseline renders found that the VITS tokenizer discards sentence
punctuation. The untreated female comfort sample contained 7,050 full-scale
samples and no internal quiet interval of 100 ms at −45 dBFS. The slow-producer
playback path could hold audio until all reply text had been synthesized.
Stage 1 changed no files. The next stage compared engines on the same words.

## Stage 2 — Engine comparison

Each engine rendered a greeting, one published PADI comfort reply, a
celebration, a question about Nigerian names and a Pidgin exchange. Each process
received a warm-up. Times below cover one render of each of the five lines at
the default user pace. Peak RSS includes the Python process and loaded models.
The machine was a two-core Celeron J4005 with 7.5 GiB RAM. [Evaluation script and exact lines](../services/voice/evaluate_speech.py)

| Engine and profile | First playable server chunk | Seconds of work per second of audio | Words/min | Peak RSS | Comfort sample |
| --- | ---: | ---: | ---: | ---: | --- |
| eSpeak NG, female `f2`, CPU | 11–24 ms | <0.01 | 147–191 | 20 MiB | [Listen](./voice-samples/signature/espeak-comfort.wav) |
| Kokoro ONNX int8, British `bf_emma`, CPU | 21.5–51.3 s | 9.57–10.96 | 185–275 | 393 MiB | [Listen](./voice-samples/signature/kokoro-comfort.wav) |
| Untuned Nigerian VITS, female, CPU | 2.24–4.08 s | 5.80–6.43 | 143–172 | 580 MiB | [Listen](./voice-samples/signature/vits-comfort.wav) |
| Signature Nigerian VITS, female, Vulkan decoder | 1.74–2.21 s | 4.41–4.73 | 94–129 | 579 MiB | [Listen](./voice-samples/signature/comfort.wav) |

All three ran locally without per-request speech charges. eSpeak is a formant
synthesizer. The tested Kokoro profile has British English pronunciation. The
evaluation used its whole-line ONNX `create` call, so its first chunk timing
measures that integration. VITS already supported overlapping decoder windows
and supplied a Nigerian-trained speaker. CPU and Vulkan rows use different
hardware paths. The figures cannot isolate the effect of prosody tuning alone.
[Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx) · [Uphando model](https://huggingface.co/Uphando-ng/naija_eng_female_accent_tts)

Stage 2 added the evaluation script and comparison recordings. The Nigerian
checkpoint advanced to Stage 3 for a listening trial. Its accent, warmth and
emotional delivery still need assessment by Nigerian English and Pidgin listeners.

## Stage 3 — One voice and its delivery

PADI’s existing profile ID now selects the adult female checkpoint in both
supported languages. The service breaks text at thought boundaries before
tokenization, uses brief relative tempo changes and scales loud peaks with
headroom. It preserves the requested pace and the words chosen by Python’s
personality system. The five final clips had zero digitally clipped samples.
The comfort sample had two internal pauses of approximately 190 and 140 ms.
[Synthesizer](../services/voice/nigerian_speech.py) · [Delivery tests](../services/voice/test_signature.py)

| Greeting | Comfort | Celebration | Names | Pidgin |
| --- | --- | --- | --- | --- |
| [Listen](./voice-samples/signature/greeting.wav) | [Listen](./voice-samples/signature/comfort.wav) | [Listen](./voice-samples/signature/celebration.wav) | [Listen](./voice-samples/signature/names.wav) | [Listen](./voice-samples/signature/pidgin.wav) |

An independent English Whisper readback missed Chinedu, Abuja and Enugu on the
signature clip. It also heard “loss” as “love” in the comfort reply. It recovered
the greeting and comfort wording more closely from Kokoro and eSpeak. These are
concrete clips for a listener to check, particularly because Whisper itself
makes errors on Nigerian speech. Vocal warmth, a recognisable identity across
emotions and genuine nonverbal laughter have no listening verdict. The VITS
interface has no separate laughter control.

Stage 3 changed the Python synthesizer, its tests, PADI’s catalog description
and the public preview cache version. Stage 4 carried the selected voice into
the new chat.

## Stage 4 — Chat, profile and memory

The landing page, country search, phone sign-in, text chat and portrait use HTML, CSS and JavaScript. The mobile WebView loads bundled local content. The host controls sign-in, the microphone, audio playback and account-owned requests. The existing native screens serve as a fallback if the document cannot open. [Entry document](../frontend/public/padi-entry.html) · [Text and portrait document](../frontend/public/padi-chat.html) · [Native host](../frontend/src/components/chat/portrait-chat.js)

Migration 000014 adds an optional country to the existing account. The device can seed an empty account from its selected country. A signed-in Settings change updates the account. Every chat turn receives the authenticated name and country. Explicit phone self-lookups resolve in the API. Preferences offered from a user's chat message open the existing account-owned Memory editor for review. [Migration](../backend/internal/database/migrations/000014_add_account_country.sql) · [Account context](../backend/internal/httpapi/chat_profile.go) · [Memory flow](personal-memory-verification.md)

## Stage 5 — Acceptance checks

An exported Chromium build ran the welcome, country and phone flow against disposable PostgreSQL and the Go API. With Nigeria selected, the configured model identified Nigeria in response to both “what do you have to say about my president” and “of my country”. The registered phone lookup, recall of an approved dislike in a new thread, streamed voice recall and switching accounts on the same device also passed.

The quiet-speech detector keeps the first 500 ms of audio before onset and trims very quiet trailing frames beyond 300 ms. The completed utterance can be checked by the existing local Whisper service when live recognition misses a short word. [Public human “hi” and “I” fixtures](../frontend/tests/fixtures/README.md) · [Detector](../frontend/public/padi-chat/voice-activity.js) · [Second recognition pass](../frontend/public/padi-chat/turn-transcript.js)

With an isolated headphone output, Chromium twice submitted the weakened “hi” correctly, including once during audible playback. Each produced one reply and the microphone closed when leaving the call. The quiet listening turn took 27.4 s from the last word to first audio on this machine. With full speaker audio fed back into the microphone, a short turn produced “guy” in one run and a request to repeat in another. Speakerphone interruption remains open. The automated frontend and Python suites passed 183 and 45 tests respectively. The Go suite and typecheck passed.

Naturalness and the emotional character of the voice still need listening review. Production latency and echo handling require physical Android and iPhone measurements. The three-second first-audio target remains open.
