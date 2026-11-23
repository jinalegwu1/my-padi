"""Explicit, one-time installation of a local CTranslate2 Whisper checkpoint."""
import argparse
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download


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
    snapshot_download(repository, revision=info.sha, local_dir=directory, allow_patterns=patterns)
    for name in ("model.bin", "config.json", "tokenizer.json"):
        if not (directory / name).is_file():
            raise SystemExit("Incomplete local model installation: " + name)
    print("Model installed. Application startup uses local files only; it never downloads a checkpoint.")


if __name__ == "__main__":
    main()
