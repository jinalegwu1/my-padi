# PADI personality instruction boundary

Python is the sole author of model personality instructions: identity, warmth, emotional responses,
humour, tone, greetings and conversation style. Go must not add rules for these
behaviours, infer a mood, choose a humour response, or rewrite conversation turns.

## Authoritative interface

`services/padi_personality/personality_config.py` defines the immutable six-trait
configuration. The short companion prompt lives in `services/padi_personality/core.py`.
A new check-in opens with a warm welcome and room for the person to answer.
The frontend supplies a rotating public gist topic, recent public topics and familiar
opening phrases as data in the hidden greeting turn. Text and voice share the selected
chat. Earlier chats can be reopened from the account's history on that device.

`padi_personality.core.export_personality()` returns exactly:

- `traits`: six explicit booleans.
- `warmth_guidance`: the authoritative composed personality instruction string.

The field name is historical: its current value includes the other composed
Python personality guidance too. Go must preserve the string exactly, including
whitespace. It must not derive replacement instructions from trait labels.

`backend/internal/personality/config.go` imports Python using isolated mode and
no bytecode writes (`-I -B`). The startup cache, five-second timeout, strict JSON
validation and error handling remain in place. An invalid export prevents API
startup; Go does not substitute its own personality defaults.

## Provider-bound flow

`CoreSettings.Guidance()` returns only the Python-exported string.
`ai.withApplicationInstructions()` is the shared boundary for `Router.Generate`,
`GenerateWithModel` and `StreamVoice`. Its system message contains, in order:

1. The Python instruction string, unchanged, when non-empty.
2. Technical application safety, privacy, capability and permission rules.
3. Supplied account, approved-memory and selected-language context.
4. Data-only conversation context: saved preferences, opted-in recent feedback
   counts and greeting intent.
5. Plain-text TTS constraints for voice requests.

All providers serialize that same prepared system message into their native
request format. Routing, retries and fallbacks do not rebuild personality. A
private preparation marker prevents repeated instruction insertion.

Go no longer has `StyleGuidance`, `SuppressHumour`, personality assessment,
greeting/continuity rule builders, or automatic feedback-based humour decisions.
Preferences and feedback remain available as application data; Go does not change
an explicit preference or decide how the model should react. Validated history
is preserved, subject to the existing memory-revision privacy boundary.

Application context must contain technical facts or permissions, never a second
personality prompt. Language instructions may enforce the app's selected
language; TTS instructions may require plain speech text. Neither may add tone,
warmth, humour, greeting, cultural-persona or emotional-response rules.

The fixed welcome, preview and call audio samples in
`backend/internal/httpapi/voice_samples.go` are outside the chat-model instruction
path and remain Go-authored scripted content. Python's current export does not
provide replacement clip text. Migrating those existing endpoints requires a
separate scope/source decision; this refactor does not establish Python ownership
of their scripted words.

## Verification and protection

Run Python tests without modifying the protected package:

```sh
python3 -B -m unittest discover -s services/padi_personality -t services -v
```

Run Go verification from `backend`:

```sh
go test ./...
```

Provider tests capture final HTTP payloads, compare the exact Python string and
an independent reviewed technical-rule snapshot, and check text, voice, streaming,
provider-native serialization, repeated preparation, fallbacks and disabled
traits. Configuration variants call the real Python export with separate immutable
configuration instances; they do not edit Python files or copies of its modules.
HTTP integration tests also capture the full chat-handler-to-provider path.

The Python export remains protected. Its current coupling of all guidance to
`warm`, and its existing trait-composition semantics, are not corrected in Go.
If Python returns empty guidance, Go delivers no substitute personality rules.
Report missing Python behaviour or technical conflicts for review rather than
adding Go instructions to compensate.

Python changes require a backend restart because the export is cached. Real
conversation and human audio evaluation remain necessary to accept behaviour;
provider-payload tests establish instruction ownership and delivery only.
