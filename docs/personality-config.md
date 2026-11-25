# PADI core personality configuration

`services/padi_personality/personality_config.py` defines the six core traits:
warm, funny, witty, intelligent, playful, and emotionally aware. All are enabled
by default. `PADI_PERSONALITY_CONFIG` is an immutable dataclass; `to_dict()`
exports a separate dictionary.

The Python `padi_personality.core` module imports that same configuration. At
startup, the Go API runs an isolated Python process to import the core and
export its settings as JSON. Go validates all six boolean values, caches the
result, and uses it through the existing `DefaultCoreSettings().Guidance()`
insertion in provider system instructions. Text and voice chat share those
instructions. The configuration load has a five-second timeout and reports
errors instead of falling back to a separate Go configuration.

Go's independent, hard-coded trait defaults were removed. Existing personality
preferences, response guidance, provider selection, the frontend, and the
private Go-to-Python voice HTTP service retain their current implementation.
The personality modules, humour engine, and emotion engine remain placeholders.

Python 3.10 or later is sufficient; this configuration has no third-party
dependencies. Go finds `python3` or `python` on PATH and locates the package
under the repository's `services` directory. For a different deployment layout,
set `PADI_PERSONALITY_PYTHON` to the Python executable and
`PADI_PERSONALITY_ROOT` to the directory containing `padi_personality`.
Restart the backend after editing the configuration.

Run from the repository root:

```sh
python3 -B -m unittest discover -s services/padi_personality -t services -v
python3 -B -m services.padi_personality.personality_config
```

The second command prints the six configured traits as JSON. Backend coverage
is included in `cd backend && go test ./...`. The provider integration test
copies the actual Python configuration and core into a temporary package,
disables `funny` and `playful` there, and verifies that the existing router sends
the changed trait list to its test provider for both text and voice requests.
It does not edit the application's configuration or contact an AI provider.
