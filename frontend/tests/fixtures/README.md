# Voice test input

`please-continue.wav` contains only the phrase "Please continue."
It was synthesised offline with the installed eSpeak NG English voice on
2026-11-20, using synchronous audio retrieval (no microphone or speaker).
It is mono, 16-bit PCM at 22,050 Hz and contains no personal recording.

The browser harness injects this fixed test input to exercise interruption and
real speech recognition. PADI's replies and spoken output still come from the
configured live AI and Python speech services. A fixed input avoids spending
provider requests on generating fixtures and keeps the speaking turn repeatable.
