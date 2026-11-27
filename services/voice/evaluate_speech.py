"""Render the same public PADI lines through one local engine per process."""
import argparse
from array import array
import io
import json
import math
from pathlib import Path
import re
import resource
import sys
import time
import wave


def conversation_samples():
    root = Path(__file__).resolve().parents[2]
    run = json.loads((root / "docs/personality-phase1-conversations.json").read_text())["conversation_run"]
    serious = next(turn["reply"] for turn in run["conversations"] if turn["name"] == "serious")
    return {
        "greeting": ("en-NG", "Hey! Good to see you. How are you doing?"),
        "comfort": ("en-NG", serious),
        "celebration": ("en-NG", "You did it, Ada! What did your mum say?"),
        "names": ("en-NG", "Chinedu, was it Abuja or Enugu? Take your time."),
        "pidgin": ("pcm-NG", "How you dey, my padi? I dey here. How your day dey go?"),
    }


def renderer(args):
    if args.engine == "vits":
        from nigerian_speech import NigerianSpeech
        model = NigerianSpeech(args.model)
        return lambda words, lang: (24000, model.chunks(words, args.voice, args.rate))
    if args.engine == "kokoro":
        import numpy as np
        from kokoro_onnx import Kokoro
        model = Kokoro(str(args.model), str(args.voices))

        def render(words, _lang):
            samples, rate = model.create(words, voice=args.voice, speed=args.rate, lang="en-gb")
            return rate, [(np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()]

        return render
    from local_speech import local_engine
    model = local_engine()

    def render(words, lang):
        with wave.open(io.BytesIO(model.speak(words, args.voice, args.rate, lang))) as wav:
            return wav.getframerate(), [wav.readframes(wav.getnframes())]

    return render


def measure(render, words, language, path):
    start = time.perf_counter()
    rate, packets = render(words, language)
    pcm = bytearray()
    first = None
    for packet in packets:
        if packet and first is None:
            first = time.perf_counter() - start
        pcm.extend(packet)
    elapsed = time.perf_counter() - start
    if not pcm or first is None:
        raise ValueError("The engine returned no audio")
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    samples = array("h", pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    # Count internal quiet intervals of at least 100 ms at a fixed -45 dBFS.
    frame = rate // 100
    active = [i for i in range(0, len(samples) - frame + 1, frame)
              if sum(x*x for x in samples[i:i+frame]) / frame > 32768**2 * 10**(-4.5)]
    duration = len(samples) / rate
    pauses = [round((b - a - frame) * 1000 / rate) for a, b in zip(active, active[1:])
              if b - a - frame >= rate / 10]
    return {"first_packet_ms": round(first * 1000), "elapsed_s": round(elapsed, 3),
            "audio_s": round(duration, 3), "real_time_factor": round(elapsed / duration, 2),
            "words_per_minute": round(len(words.split()) * 60 / duration),
            "internal_quiet_ms": pauses, "peak_dbfs": round(20 * math.log10(max(1, max(map(abs, samples))) / 32768), 2),
            "clipped_samples": sum(abs(x) >= 32767 for x in samples)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", choices=["espeak", "vits", "kokoro"])
    parser.add_argument("--voice", default="ada", help="VITS/eSpeak style or Kokoro stock voice")
    parser.add_argument("--rate", type=float, default=1)
    parser.add_argument("--model", type=Path, help="Local VITS directory or Kokoro ONNX file")
    parser.add_argument("--voices", type=Path, help="Local Kokoro voice bank")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9_-]+", args.voice) or not 0.5 <= args.rate <= 1.5:
        parser.error("Choose a valid voice and a rate between 0.5 and 1.5")
    if args.engine != "espeak" and not args.model or args.engine == "kokoro" and not args.voices:
        parser.error("Provide the local model files")
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    render = renderer(args)
    report = {"engine": args.engine, "voice": args.voice, "rate": args.rate,
              "load_ms": round((time.perf_counter() - started) * 1000), "samples": {}}
    # Each candidate gets the same warm-up, excluded from all measured turns.
    _, warm = render("Hello.", "en-NG")
    for _ in warm:
        pass
    for name, (lang, words) in conversation_samples().items():
        metrics = measure(render, words, lang, args.output / (name + ".wav"))
        report["samples"][name] = {"text": words, **metrics}
        print(name, json.dumps(metrics), flush=True)
    report["peak_rss_mib"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024**2 if sys.platform == "darwin" else 1024))
    (args.output / "measurements.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
