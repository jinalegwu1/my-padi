# Hands-free Python Voice Engine verification

Date: 2026-11-18. Status: **Testing**, pending native compilation and physical
Android/iPhone checks. JavaScript bundle export is not native compilation.

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

## Setup

From the project root:

```sh
python3 -m venv services/voice/.venv
services/voice/.venv/bin/python -m pip install -r services/voice/requirements.txt
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

## Native build and physical verification still required

Expo Go cannot load the new echo-cancelled microphone module. Use an Expo
**development build** containing PadiVoice and expo-dev-client. Android needs
Java/Android SDK; iPhone compilation needs macOS/Xcode or a configured EAS build.
Those native toolchains are absent from this workspace, so native compilation
and actual microphone/speaker/echo behavior have not been verified here.

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
