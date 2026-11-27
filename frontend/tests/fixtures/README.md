# Voice test input

`please-continue.wav` contains only the phrase "Please continue."
It was synthesised offline with the installed eSpeak NG English voice on
2026-11-20, using synchronous audio retrieval (no microphone or speaker).
It is mono, 16-bit PCM at 22,050 Hz and contains no personal recording.

The browser harness injects this fixed test input to exercise interruption and
real speech recognition. PADI's replies and spoken output still come from the
configured live AI and Python speech services. A fixed input avoids spending
provider requests on generating fixtures and keeps the speaking turn repeatable.

The incoming-only pipeline also uses these public human speech fixtures:

- `clear-english.wav`: the public whisper.cpp Kennedy sample, containing
  “And so my fellow Americans, ask not what your country can do for you, ask
  what you can do for your country.” The underlying U.S. government speech is
  public domain. Source: <https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav>.
- `nigerian-english-short.wav`: “Invoices are always issued with terms of
  payment.” Nigerian-accented English dataset, test row 1.
- `nigerian-english-long.wav`: “Niger Delta is sometimes called the Oil Rivers
  because it was once a major producer of palm oil.” Same dataset, test row 0.
  Published dataset licence: Apache-2.0. Source:
  <https://huggingface.co/datasets/benjaminogbonna/nigerian_accented_english_dataset>.
- `nigerian-pidgin.wav`: “if you wan do dat one na you sabi but make sure say
  you dey monitor your pikin well well”. Nigerian Pidgin 1.0, test row 3.
  Published dataset licence: CC-BY-4.0. Source and attribution:
  <https://huggingface.co/datasets/asr-nigerian-pidgin/nigerian-pidgin-1.0>.

The three Nigerian clips were retrieved from their public dataset audio assets
on 2026-11-23 and converted once to mono 16 kHz PCM WAV for repeatable tests.
No speaker identity/client identifier is included. `transcription.json` records
published references, source revisions, row numbers and file hashes. References
are dataset annotations; the limited fixtures do not establish dialect-wide
accuracy. The noise/silence variants are generated at test time and deleted.
Normal microphone recordings and model checkpoints are never committed here.

## Short greetings

`hi-soft-onset.wav` derives from Dvortygirl's recorded “hi”. The regression
fixture is mono 16 kHz PCM. Its amplitude is 15% of the source, with the first
212 ms further attenuated to simulate a microphone weakening the initial “h”
(10 ms transition). It has one second of leading and two seconds of trailing
silence. This adaptation is distributed under CC BY-SA 3.0.
[Recording](https://commons.wikimedia.org/wiki/File:En-us-hi.ogg) · [License](https://creativecommons.org/licenses/by-sa/3.0/)

`spoken-i.wav` derives from Muke Tever's public-domain recording of the
pronoun “I”. It uses the same format and edge silence, at 6% amplitude.
Both source recordings are US English. [Recording and dedication](https://commons.wikimedia.org/wiki/File:En-us-I.ogg)
