"""Explicit, one-time installation of a local CTranslate2 Whisper checkpoint."""
import argparse
from pathlib import Path
import shutil
import tempfile

from huggingface_hub import HfApi, snapshot_download
from install_conversation_models import download_weights


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("tiny", "base", "small"), default="base")
    parser.add_argument("--directory", type=Path)
    args = parser.parse_args()
    directory = args.directory or Path(__file__).parent / "models" / args.model
    repository = "Systran/faster-whisper-" + args.model
    info = HfApi().model_info(repository, files_metadata=True)
    patterns = ["model.bin", "config.json", "tokenizer.json", "preprocessor_config.json", "vocabulary.*"]
    import fnmatch
    size = sum(file.size or 0 for file in info.siblings if any(fnmatch.fnmatch(file.rfilename, pattern) for pattern in patterns))
    print(f"Installing {repository} ({size / 1024 / 1024:.1f} MiB) into {directory.resolve()}", flush=True)
    snapshot_download(repository, revision=info.sha, local_dir=directory, allow_patterns=patterns[1:])
    weight = next(file for file in info.siblings if file.rfilename == "model.bin")
    target = directory / weight.rfilename
    if not target.is_file() or target.stat().st_size != weight.size:
        cache = directory / (".download-" + info.sha)
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            stage = Path(temporary) / weight.rfilename
            download_weights(f"https://huggingface.co/{repository}/resolve/{info.sha}/model.bin",
                             stage, cache, weight.size, weight.lfs.sha256)
            stage.replace(target)
        shutil.rmtree(cache)
    for name in ("model.bin", "config.json", "tokenizer.json"):
        if not (directory / name).is_file():
            raise SystemExit("Incomplete local model installation: " + name)
    print("Model installed. Application startup uses local files only; it never downloads a checkpoint.")


if __name__ == "__main__":
    main()
