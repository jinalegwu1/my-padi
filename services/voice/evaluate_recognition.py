"""Offline evaluation of checked-in public speech fixtures; never downloads.

This is an explicit engineering test command. Normal requests never log text.
"""
import argparse
import io
import json
from pathlib import Path
import re
import tempfile
import time

from local_recognition import RecognitionConfig, load_model, recognise_file
from test_incoming_voice import encode_recording


def word_error(reference, recognised):
    expected = re.findall(r"\w+", reference.casefold())
    actual = re.findall(r"\w+", recognised.casefold())
    previous = list(range(len(actual) + 1))
    for i, word in enumerate(expected, 1):
        row = [i]
        for j, observed in enumerate(actual, 1):
            row.append(min(row[-1] + 1, previous[j] + 1, previous[j - 1] + (word != observed)))
        previous = row
    return {"word_errors": previous[-1], "reference_words": len(expected), "word_error_rate": previous[-1] / max(1, len(expected))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", choices=("tiny", "base", "small"), default=["base"])
    parser.add_argument("--fixtures", nargs="+")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--compare-wav", action="store_true")
    args = parser.parse_args()
    directory = Path(__file__).resolve().parents[2] / "frontend/tests/fixtures"
    fixtures = json.loads((directory / "transcription.json").read_text())
    if args.fixtures:
        fixtures = [item for item in fixtures if item["id"] in args.fixtures]
    if not fixtures:
        raise SystemExit("No matching public speech fixtures")
    results = []
    for name in args.models:
        config = RecognitionConfig(model=name, model_path=str(Path(__file__).parent / "models" / name))
        began = time.monotonic()
        model = load_model(config)
        loaded_ms = round((time.monotonic() - began) * 1000, 2)
        with tempfile.TemporaryDirectory(prefix="padi-public-stt-evaluation-") as temporary:
            for fixture in fixtures:
                source = directory / fixture["file"]
                path = Path(temporary) / "public.webm"
                encode_recording(path, source.read_bytes())
                inputs = [(path, "audio/webm")]
                if args.compare_wav:
                    inputs.insert(0, (source, "audio/wav"))
                for recording, mime in inputs:
                    language = "pcm" if fixture["language"] == "pcm-NG" else fixture["language"]
                    result = recognise_file(model, config, str(recording), mime, language)
                    result.update({"fixture": fixture["id"], "reference": fixture["reference"], "model_load_ms": loaded_ms, **word_error(fixture["reference"], result["text"])})
                    result["compression_saving_percent"] = round(100 * (1 - result["audio_bytes"] / result["decoded_pcm_bytes"]), 2)
                    results.append(result)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
        del model
    if args.output:
        args.output.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
