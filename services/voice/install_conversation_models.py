"""Install the pinned, public models used in live conversations. No account is required."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import shutil
import tempfile
import time
import urllib.request
import zipfile

MODEL_DIR = Path(__file__).parent / "models"
VOSK_NAME = "vosk-model-small-en-us-0.15"
VOSK_SHA256 = "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"
VOICES = {
    "male": "73feb65b912099ea42a048db944bad7f9de4c942",
    "female": "8c5b5e0c52af6da08ed8543f508638adcaa2d3e8",
}
VOICE_FILES = ("config.json", "vocab.json", "tokenizer_config.json", "special_tokens_map.json",
               "added_tokens.json", "model.safetensors", "README.md")
WEIGHT_BYTES = 332160712
WEIGHT_DIGESTS = {"male": "4946cf85e6633174a9fd956004eb71652546e63ee2d39dca9bbe2fdb9538796b",
                  "female": "ca90b02dff0f408aaf21b7ac95704a0b4be7e583893a85da84d8a92ee1705326"}


def download(url, destination):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=90) as response, destination.open("wb") as output:
                shutil.copyfileobj(response, output)
            return
        except OSError:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def download_weights(url, destination, cache, size, checksum):
    # Retries restart just one bounded HTTP range on slow connections.
    block = 4 * 1024 * 1024
    cache.mkdir(exist_ok=True)

    def part(start):
        end = min(start + block, size) - 1
        saved = cache / str(start)
        if saved.is_file() and saved.stat().st_size == end - start + 1:
            return
        request = urllib.request.Request(f"{url}?download=true&offset={start}",
                                         headers={"Range": f"bytes={start}-{end}"})
        for attempt in range(6):
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    if response.headers.get("Content-Range") != f"bytes {start}-{end}/{size}":
                        raise OSError("Unexpected voice download range")
                    data = response.read(end - start + 2)
                if len(data) != end - start + 1:
                    raise OSError("Incomplete voice download range")
                temp = saved.with_suffix(".partial")
                temp.write_bytes(data)
                temp.replace(saved)
                return
            except OSError:
                if attempt == 5:
                    raise
                time.sleep(2 ** attempt)

    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(part, range(0, size, block)))
    digest = hashlib.sha256()
    with destination.open("wb") as output:
        for offset in range(0, size, block):
            piece = (cache / str(offset)).read_bytes()
            digest.update(piece)
            output.write(piece)
    if digest.hexdigest() != checksum:
        shutil.rmtree(cache)
        raise ValueError(f"{destination.name} checksum mismatch")


def install(root):
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root) as work:
        stage = Path(work)
        if not (root / VOSK_NAME).is_dir():
            archive = stage / "recognizer.zip"
            download(f"https://alphacephei.com/vosk/models/{VOSK_NAME}.zip", archive)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != VOSK_SHA256:
                raise ValueError("Live recognition model checksum mismatch")
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(stage)
            os.rename(stage / VOSK_NAME, root / VOSK_NAME)
        for gender, revision in VOICES.items():
            target = root / f"naija-{gender}"
            if all((target / name).is_file() for name in VOICE_FILES):
                continue
            folder = stage / target.name
            folder.mkdir()
            source = f"https://huggingface.co/Uphando-ng/naija_eng_{gender}_accent_tts/resolve/{revision}"
            for name in VOICE_FILES:
                print(f"Installing {target.name}/{name}", flush=True)
                if name == "model.safetensors":
                    download_weights(f"{source}/{name}", folder / name, root / f".{gender}-download",
                                     WEIGHT_BYTES, WEIGHT_DIGESTS[gender])
                else:
                    download(f"{source}/{name}", folder / name)
            target.mkdir(exist_ok=True)
            for name in VOICE_FILES:
                (folder / name).replace(target / name)
            shutil.rmtree(root / f".{gender}-download")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=MODEL_DIR)
    install(parser.parse_args().directory)
