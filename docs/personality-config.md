# PADI core personality configuration

`services/padi_personality/personality_config.py` defines the six core traits:
warm, funny, witty, intelligent, playful, and emotionally aware. All are enabled
by default. `PADI_PERSONALITY_CONFIG` is an immutable dataclass; `to_dict()`
exports a separate dictionary.

Python owns warmth behaviour. `personalities/best_friend.py` defines attentive
companionship and `personalities/emotional_intelligence.py` defines warmth's
emotional support. `conversation/response_style.py::build_warmth_guidance`
composes them with natural conversation and greeting guidance when `warm` is
enabled. It returns an empty string when warmth is disabled.

At startup, the Go API runs an isolated Python process calling
`padi_personality.core.export_personality()`. The JSON contains `traits` (the
unchanged six booleans) and `warmth_guidance` (a string). Go rejects missing,
unknown, duplicate, malformed, or inconsistent fields: enabled warmth requires
non-whitespace guidance and disabled warmth requires an empty string. The
export is cached and the exact Python guidance is delivered once through the
existing `DefaultCoreSettings().Guidance()` insertion for text generation and
`StreamVoice`. The five-second timeout and error handling remain in place.

Go supplies conversation context and current-turn signals rather than duplicate
warmth instructions. Existing humour controls, safety rules, the other five
traits, provider selection, the frontend, and the private voice HTTP service
retain their existing behaviour. The humour and emotion engines remain
placeholders; warmth does not add an engine or third-party dependencies.

Python 3.10 or later is sufficient; this configuration has no third-party
dependencies. Go finds `python3` or `python` on PATH and locates the package
under the repository's `services` directory. For a different deployment layout,
set `PADI_PERSONALITY_PYTHON` to the Python executable and
`PADI_PERSONALITY_ROOT` to the directory containing `padi_personality`.
Restart the backend after editing the configuration or Python guidance.

Run from the repository root:

```sh
python3 -B -m unittest discover -s services/padi_personality -t services -v
python3 -B -m services.padi_personality.personality_config
```

The second command still prints only the six configured traits as JSON. Backend
coverage is included in `cd backend && go test ./...`. The provider integration
test copies the Python warmth modules into a temporary package, independently
exports their exact guidance, and checks text generation, voice generation,
and `StreamVoice` with enabled/disabled warmth, humour off, and grief. These
tests use local provider fixtures and do not establish conversation quality.

The opt-in `TestLivePersonalityConversations` accepts
`PADI_PERSONALITY_LIVE_FILTER=warmth-regression` for the exact greeting and
new-phone examples, multi-turn positive/neutral/negative contexts, serious
support, and requested help. `warmth-regression-voice` evaluates the same voice
cases in a fresh process with slower pacing. The existing `warmth` and
`warmth-recheck` samples remain available. Set
`PADI_RUN_LIVE_PERSONALITY_TESTS=true` with the configured development provider
environment; `PADI_PERSONALITY_EVIDENCE_FILE` saves the real replies.

The earlier November 25 review found exaggerated sympathy and unsolicited help
in casual replies. The warmth correction makes emotional support conditional:
ordinary greetings stay friendly, positive updates invite specific interest,
and serious context remains active through follow-ups.

Delivery previously ignored provider finish reasons and accepted stream EOF as
completion. Social budgets of 96–256 tokens also cut into hidden reasoning.
The corrected adapters require terminal completion metadata, reject unfinished
clauses, and distinguish output limits from complete answers. Social and ordinary
voice turns allow 1,024 tokens. A capped text response can be regenerated once
with a larger budget, bounded by the existing 4,096-token maximum; voice retries
only before any text is emitted. An interrupted voice stream emits an error
and no done event. Consumed usage is recorded even for capped attempts.

The corrected live text sample completed eleven turns, including natural
greetings, new-phone interest, casual follow-up without unsolicited advice, and
serious support. Real output-limit detection recovered seven capped attempts.
A fresh voice run confirmed the greeting and new-phone responses; provider
rate limits blocked later cases. These observations are not warmth acceptance:
the full voice conversation set and human audio listening remain required, and
the memory follow-up still inferred details not explicitly supplied.

Warmth still requires real conversation evaluation in text and voice: ordinary
sharing followed by a specific detail, casual sharing with humour off, good news
and a follow-up, spontaneous banter, grief with a request to listen, and an
explicit request for practical help. Review attention, naturalness, proportionate
emotion, context continuity, and preserved serious support. Automated passes do
not mean Phase 1 has been accepted.
