# Hands-free Python Voice Engine verification

Date: 2026-11-20. Status: **Testing**, pending iOS native compilation, physical
Android/iPhone checks, and human review of voice naturalness. Android's local
development APK build passed and includes the PadiVoice module. Revised voice
quality still needs listening review. The newer speech connection now returns
real preview audio after the earlier model exhausted its provider allowance.

## Implemented

- Start conversation opens the microphone for the foreground voice session.
- Speaking turns are detected automatically. A pause of about 1.1 seconds ends
  the turn; no Stop-and-send or text-send button is needed.
- Python performs WebRTC voice activity detection, PCM conversion to 16 kHz
  mono, trimming, low-frequency rumble/DC reduction, Groq speech recognition,
  transcript validation, and expressive Gemini speech generation.
- Go authenticates requests, keeps provider usage accounting, supplies the
  consistent PADI instructions, and applies account/memory consent boundaries.
- PADI uses conversational wording with natural speech delivery and normal
  pitch. Natural output is real Gemini audio generated through Python.
- Microphone capture continues while PADI thinks and speaks. Speaking again
  cancels response generation/playback and keeps recognised unsent user words
  for the next turn. Successful replies remain in the shared conversation.
- Fully played speech segments are tracked. When interrupted, PADI receives the
  last completed portion on the next request. It may repeat an interrupted
  sentence because word-level playback timestamps are not guessed.
- Voice and text share confirmed conversation history and approved memory.
  Memory revision changes discard old interrupted-voice context as well.
- Pause, End, navigation away, backgrounding, and account changes stop capture.
  Account changes discard queued audio and private voice captions. Temporary
  files are removed; recordings are not persisted by Python or Go.
- Browser capture requests echo cancellation/noise suppression and uses a
  foreground AudioWorklet. Android uses VOICE_COMMUNICATION with available OS
  echo cancellation; iPhone uses voiceChat and AVAudioEngine voice processing.
  Phone playback goes through the communication audio path.

Local detection provides fast turn/interrupt signals; Python VAD validates the
captured audio before recognition. This is not speaker identification. Other
people speaking nearby and some background noise can still be picked up.
Android echo-cancellation availability and quality depend on the device.

## Software checks

- Python unit/HTTP/audio tests: 6 passed.
- Frontend tests: 42 passed, including automatic turn completion, interruption,
  pending-user-word preservation, account changes, speech detection and WAV
  framing, plus the existing chat/memory cases.
- Go tests and vet passed, including voice style/context, memory revision
  boundaries, and private Python speech transport.
- TypeScript passed.
- Android/iOS Hermes JavaScript bytecode and web export passed in
  `/tmp/my-padi-handsfree-export`.
- Expo autolinking resolves the PadiVoice native module for Android and Apple.
- Live Python/Groq recognition matched the public whisper.cpp JFK speech fixture.
- Live Gemini returned actual PCM speech, which Python wraps as 24 kHz mono WAV.
- The full browser test used only public sample audio and a synthetic account:
  automatic transcription/reply, real audio playback, return to listening, no
  Stop-and-send control, and microphone closure after Pause all passed. The
  synthetic account and authentication challenge were removed afterwards.
- A second live browser test injected public speech during playback and passed:
  playback stopped, the interrupted reply was marked, continuation context was
  sent with the next request, PADI answered again, and Pause closed capture.
  This verifies software interruption handling; physical echo rejection still
  needs real device checks.
- Voice previews now use the same Python-generated speech as conversations,
  without opening the microphone. Preview files are cleaned on interruption.
- The browser test exposed Groq rejecting Python's default HTTP client identity.
  Standard application User-Agent headers fixed the API connection; no provider
  authentication or quota restrictions were bypassed.

### November 20 checks and voice-quality changes

- Prepared Python's virtual environment and pinned dependency. Corrected broken
  lines, duplicate assignments, and overriding placeholder model IDs in local
  configuration; the documented free models and existing credentials now start
  a database-ready Go/Python/Expo stack.
- A live API test matched public JFK speech, rejected silence, obtained an AI
  reply and real PCM speech, recorded usage, and cleaned its synthetic account.
- Browser checks exercised text → voice → text context, automatic speech
  recognition/replies/playback, interruption and continuation, plus capture
  closure on Pause, End and navigation. Microphone denial and a controlled
  transcription-service outage also passed.
- Later full browser reruns received HTTP 429 from natural speech. These are
  failed live runs; earlier successes do not guarantee provider availability
  or subjective voice quality.
- Removed browser/device speech synthesis from all application source paths.
  Introductions and all seven previews use cached, fixed Go/Python voice clips.
  Personal weather greetings use authenticated natural speech; signed-out
  users retain their greeting as text until they sign in.
- Public clips accept fixed phrases and known sample settings only. They
  cannot proxy arbitrary unauthenticated personal text. Concurrent requests
  share generation; failed samples are briefly cached to avoid repeated calls.
- Delivery now requests connected conversational phrasing, natural emphasis
  and normal pitch. Typical replies remain in one coherent passage, and
  interruption tracking counts only fully completed passages.
- Every voice selection uses the expressive engine. The default style is
  labelled PADI while retaining the stored `baby` identifier for compatibility.
  Preview phrases always retain PADI's identity, including the Amara option.
- 45 frontend tests, six Python tests, TypeScript, backend voice regressions,
  and Go HTTP/API race checks passed. Android compilation found missing local
  module version metadata; adding it made PadiVoice Kotlin compilation pass.
  Apple autolinking resolves PadiVoice.

### Nigerian delivery revision after listening feedback

- The user rejected the previous speech as unnatural. Voice quality remains
  **Testing**; automated playback checks do not override that feedback.
- PADI's default stored `baby` style now uses Orus with a fuller, confident,
  expressive adult male character. The existing named voice choices remain.
  Delivery uses PADI's own identity without copying a real person's voice.
- All styles receive connected conversational phrasing, varied emphasis and
  emotionally appropriate pacing. Nigerian English and Pidgin now have explicit
  pronunciation and cadence directions. Other selected languages receive their
  own pronunciation directions; transcripts are not translated by speech.
- Selected language now reaches Python from personal greetings and voice
  conversations. Go and Python validate language codes before generation.
  Fixed introductions keep their selected language, including French. Tunde's
  public preview receives Pidgin directions; other previews use Nigerian English.
- 46 frontend tests, six Python tests, TypeScript, all Go package tests and
  `go vet ./...` passed after this revision. The added checks cover language
  transport and rejection of unapproved delivery inputs; they do not evaluate
  how natural or authentically Nigerian the generated audio sounds.
- Restarted Go, Python and Expo to load the revision. One fresh default PADI
  preview attempt returned HTTP 429 from the speech provider. No revised audio
  sample was obtained, and no further live generation attempts were made in
  this revision. Earlier sample files contain the previous delivery.
- Browser failure checks passed after the revision: denied microphone permission,
  transcription failure, and unavailable introduction/all seven previews were
  reported accurately, with no device speech or fake playback. This run generated
  no AI replies or speech and does not verify the revised sound.

### Original Nigerian voice and newer speech connection

- A controlled diagnostic identified the earlier model's provider limit as
  10 free speech generations per project per day. The provider returned a
  51,520-second retry delay. This was a provider allowance, not PADI's own caps.
- At the user's request, quota changes were left aside. The existing
  `PADI_DEV_BYPASS_AI_USAGE_LIMITS=true` development setting remains active.
  No counters, provider allowances, or billing settings were reset or changed.
- Checked the provider's published free-tier pricing and the account's model
  listing for `gemini-3.8-flash-tts`. Created one original Nigerian adult male
  PADI profile through Voice design, without a reference recording or a
  real-person imitation. Its generated sample is available for listening review.
- The development backend now selects the newer model and original profile
  through server-only `PADI_VOICE_MODEL` and `PADI_VOICE_DEFAULT_ID` settings.
  All named choices use the newer engine; the default uses the original profile.
  Existing app style IDs, authentication and playback formats remain supported.
- The newer model receives exact transcript text with separate delivery metadata.
  Its WAV response is validated and normalised to 24 kHz mono, 16-bit PCM; the
  earlier PCM response remains supported. Eight Python tests passed, including
  invalid/truncated WAV rejection and checks that directions remain outside
  spoken text. Launcher syntax and whitespace checks also passed.
- Restarted the services and received HTTP 200 with real, valid speech from
  `/v1/voice/preview?style=baby&rate=1`. The connected short sample is at
  `/tmp/my-padi-original-nigerian-preview.wav`; the profile-design sample is at
  `/tmp/my-padi-original-nigerian-voice.wav`. These temporary artifacts are outside
  Git. The new voice has not yet been approved as natural by the user.

Provider allowances remain external constraints. A successful preview does not
establish unlimited access, verify every voice's sound, or replace physical
Android/iPhone voice checks.

### Daniel preview and persistent public clips

- Daniel's current normal-speed preview returned HTTP 200 with real WAV audio
  during investigation of the reported rate-limit error.
- Successful fixed introductions and previews can now be stored in Go's
  `PADI_VOICE_SAMPLE_CACHE_DIR`. Files are keyed by speech version, model,
  original profile, selected style/language/rate and exact public phrase.
  Invalid audio, changed phrases and changed voice profiles are rejected.
- Stored clips survive backend restarts and can play while generation is
  unavailable. Account-linked greetings and arbitrary personal speech are not
  stored in this cache. Failed generation is never stored as audio.
- Enabled the ignored `.voice-samples` directory for development and preserved
  the existing successful PADI and Daniel previews before restarting the app.
  Both returned HTTP 200 after restart with exactly the same audio and text.
  Unit tests passed for reuse across restarts, malformed cache rejection,
  profile invalidation and refusal of unapproved public text. Concurrency
  checks also passed. PADI's development usage-limit bypass remains active.
- Account recognition and the approved Nigerian companion behaviour were
  connected to the shared chat context. See
  [personal-memory verification](./personal-memory-verification.md).

### Flash-Lite TTS switch

- The user approved the current sound and selected `gemini-3.8-flash-lite-tts`
  to replace `gemini-3.8-flash-tts`. Gemini 3.5 Flash was checked against the
  provider's model documentation: it produces text, has no audio generation,
  and is deprecated. It was not substituted as a speech model.
- Added the compatible Flash-Lite TTS variant to the Python model checks while
  retaining the original PADI voice profile, selected styles and delivery
  metadata. Nine Python tests passed, including both variants across all styles
  and rejection of a text model as a working speech model.
- A controlled Flash-Lite request with the existing original PADI profile
  returned HTTP 200 and valid WAV speech. Its review sample is at
  `/tmp/my-padi-flash-lite-preview.wav`.
- Updated the development voice-model setting and restarted services. The
  existing original voice ID, billing configuration and development usage
  bypass were preserved. Four existing successful public clips were carried
  forward to retain the sound already reviewed by the user. Those clips were
  generated with the earlier full TTS model; fresh generation now uses Lite.
- Provider quotas still apply. One successful generation verifies access and
  transport, not unlimited availability or identical delivery on every request.

Generation and playable audio are software checks. Naturalness, accent quality,
echo rejection, and microphone/speaker behavior still need human listening and
physical devices. A speech-service failure keeps text available and is reported
instead of being replaced with a robotic fallback.

## Setup

From the project root:

```sh
npm run setup:voice
npm run dev
```

The current local backend environment enables `PADI_STT_ENABLED` and
`PADI_PYTHON_VOICE_ENABLED`. Existing development OTP/quota bypass settings
remain unchanged. Gemini/Groq keys stay server-side. Python receives only its
required keys and an internal service token; the frontend receives none.

The launcher starts Python on loopback port 8090, Go on 8080, and Expo on 8081.
Python endpoints are internal and token-protected. Go exposes authenticated
`/v1/voice/transcribe` and `/v1/voice/speak`, plus public capability configuration.
Voice defaults disabled in committed example configuration.

With the services running:

```sh
npm run verify:voice
npm run verify:voice:browser
# Failure checks without generating AI replies or speech:
npm run verify:voice:browser -- --failures-only
```

Fixed introductions/previews are served by `/v1/voice/welcome` and
`/v1/voice/preview`. They contain no personal information and are cached by Go.
Personal speech and conversations remain authenticated. Provider limits still
apply; missing connections, accounts, or voice quota are reported clearly.

## Native build and physical verification still required

Expo Go cannot load the new echo-cancelled microphone module. Use an Expo
**development build** containing PadiVoice and expo-dev-client. Android needs
Java/Android SDK; iPhone compilation needs macOS/Xcode or a configured EAS build.
Android's temporary Java/SDK toolchain is under
`/tmp/my-padi-voice-native-tools`. The full ARM64 development APK build passed
with the installed animation libraries. Signature verification and APK inspection
confirmed `com.mypadi.app.voicetest`, the **My PADI Voice Test** label, microphone
permission, and the PadiVoice module. A copy is at `/tmp/my-padi-voice-test.apk`;
this debug development build needs Metro and Go services and is outside Git.
iOS needs a macOS/Xcode or EAS build. No Android phone is connected here, and
actual microphone/speaker/echo behavior remains unverified.

On a machine with the required toolchain:

```sh
cd frontend
npx expo run:android
# On macOS, for iPhone/iOS:
npx expo run:ios
```

The development EAS build profile is prepared for teams using EAS; no external
build has been submitted automatically.

Before marking Verified, test on real Android and iPhone devices:

1. Start conversation, speak, pause naturally, and hear PADI reply automatically.
2. Interrupt PADI mid-reply; confirm it stops promptly and hears the new words.
3. Ask it to continue; verify it resumes after the last fully spoken segment.
4. Switch to text and back, and exercise approved/paused/deleted memories.
5. Test speakerphone, wired/Bluetooth headsets, device interruptions, locking,
   navigation away, account switching, microphone denial, and network failure.
6. Check echo rejection, noisy rooms, soft speech, Nigerian English/Pidgin, long
   utterances, screen readers, and enlarged text. Echo cancellation and voice
   naturalness require human listening and physical device checks.

There is no artificial three-hour rest schedule. A single audio segment is
bounded for upload/processing, while the foreground conversation can continue
through successive turns. Provider account limits still apply.

Dedicated Nigerian voices, guaranteed local-language accuracy, wake words,
voice-triggered phone actions, and the other Python engines remain planned.
See [the Python roadmap](./python-roadmap.md). Calls/messages/emails require
separate platform integrations and approval before each action.
