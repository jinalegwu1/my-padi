# Phase 1 personality implementation and review

Implemented on `main`, preserving the existing dirty voice work. Provider/model configuration, routing, authentication, database schema, memory storage, and feedback consent were not changed by this phase. The existing personality module and shared AI instruction assembly remain the only personality foundation.

## Changes

- Subtle and occasional humour now allow spontaneous everyday wit. Frequency guidance distinguishes subtle, occasional, and frequent. Humour off retains warmth and interest; an explicit joke invitation remains a one-turn exception, preserving existing preference semantics.
- Added social-intent, original observation, sarcasm, earned laughter, affectionate teasing, concise conversation, and cultural/language guidance. Removed mandatory emoji frequency and the canned friendship example. Serious requests, painful experiences, grief, and distress override humour. Figurative “I died laughing” and a dead phone no longer trigger bereavement guidance.
- Replaced fixed first/new text and voice greetings with generated greetings through the existing authenticated chat paths. No added voice controls or greeting screen. Removed the age/gender title substitution and onboarding's duplicate canned chat greeting; weather onboarding itself remains intact.
- Greeting requests carry a boolean to let the server assess the previous user turn after validating the memory revision. Stale memory context is never copied into a synthetic greeting request. Greeting prompts do not appear as user messages. Saved preferences, conversation context, existing text routing, strict Groq voice streaming, and Groq TTS remain in use.
- New chat retains only an allowlisted nonpersonal opening word in memory to request variation. Account changes clear it. No joke bank or personal greeting cache was introduced.
- Speech guidance preserves the same personality while disallowing emoji reading, laughter stage directions, and unsupported nonverbal laughter. Existing speech cleanup removes decorative emoji before synthesis.

## Files changed for this phase

Production:

- `backend/internal/ai/instructions.go`
- `backend/internal/personality/personality.go`
- `backend/internal/httpapi/auth_chat.go`
- `frontend/src/lib/greeting.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/state/chat-context.tsx`
- `frontend/src/hooks/use-voice-session.ts`
- `frontend/src/app/(tabs)/chat.tsx`
- `frontend/src/app/onboarding/location.tsx`

Verification:

- `backend/internal/ai/instructions_test.go`
- `backend/internal/ai/evaluation.go` and `evaluation_test.go`
- `backend/internal/ai/router_test.go`
- `backend/internal/personality/personality_test.go`
- `backend/internal/httpapi/auth_chat_test.go`, `personality_foundation_test.go`, `transcription_test.go`, and `voice_browser_test.go`
- `frontend/tests/greeting.test.cjs`, `chat-state.test.cjs`, `voice-session-hook.test.cjs`, and `voice-api.test.cjs`
- `frontend/tests/personality-browser.cjs`, `voice-playback-browser.cjs`, and `voice-interruption-browser.cjs`
- `scripts/verify-personality.mjs`
- This report and `personality-phase1-conversations.json`

The circuit-breaker test now uses a non-budgeted fixture so prompt size cannot exhaust its daily allowance before testing the circuit. Production budgets are unchanged. The upload cancellation fixture now preserves its known HTTP Content-Length, correcting a chunked-upload test artifact. Voice browser fixtures recognise generated greeting requests, clear greeting timing samples before response measurements, and distinguish pre-scheduled nodes from audio created after interruption.

## Verification and actual limitations

- `cd backend && go test ./...`: PASS, all packages. Opt-in external integration checks remain opt-in.
- `cd frontend && npm run typecheck`: PASS.
- Focused Node tests for greeting, chat state, voice hook/API, preferences, hands-free turns, streaming speech, and speech cleanup: 59 passed, 0 failed.
- `node scripts/verify-personality.mjs`: completed a real 24-response text/voice scenario run plus first/new/returning greetings (786.02 seconds). Covered all requested categories, including serious support, serious factual questions, humour off/subtle, sarcasm, teasing, independent observations, and earned text laughter. The voice samples use actual Groq streams; ordinary text uses existing configured routing.
- `node scripts/verify-personality.mjs --greetings-only`: PASS with final opening variation hint (94.00 seconds). Actual request capture confirms its use. Actual Groq greeting audio played in Chromium, playback completed, listening resumed, and switching to text retained the spoken reply.
- `node scripts/verify-voice-playback.mjs --interruptions`: FAIL. Latest run reached repeated interruptions but then an unexpected speaker-audio transcription occurred. Earlier runs exposed audit timing errors and an intermittent “Stop” → “Start” transcription. The source audio itself transcribed correctly offline. These failures are not dismissed or counted as passes.
- Several initial live attempts failed due to Groq throttling, a text-provider outage, and browser fixture setup. The verification harness now spaces model requests to respect quotas; this pacing is not part of product playback.

## Product review

Structural checks passed; personality quality is **not fully accepted**. The recorded responses demonstrate warmth, occasional wit, an earned laughing emoji, and serious support, but also repeated openings, awkward comparisons, generic questions, and advice in social moments. Some teasing still produces a promise to simplify instead of a clever comeback. Humour-off voice can still take a figurative fridge comment literally, and a final text sample still included a mild comic comparison with humour off. Greetings vary in wording but sometimes sound too theatrical or generic.

The evidence JSON preserves actual responses, including these weaknesses. Do not treat illustrative instructions or unit tests as proof that humour is consistently good. The final speech-only suffix received Go coverage and a six-response live review (`--review-only`, PASS structurally, 193.22 seconds). That review still showed a mild comic comparison with humour off and a voice “Ha!”; these are unresolved generation-quality failures, not accepted behaviour. Physical-device acoustics and human-perceived continuous speech were not verified in this phase.

Run focused live checks with the existing development services running:

```sh
node scripts/verify-personality.mjs
node scripts/verify-personality.mjs --greetings-only
node scripts/verify-personality.mjs --review-only
```

These checks use a synthetic account and real configured providers, remove the account afterwards, block non-Groq voice synthesis, and write only synthetic conversation evidence under `/tmp/my-padi-personality`.
