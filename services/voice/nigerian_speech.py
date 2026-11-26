"""Local Nigerian English neural voices shared by calls, previews and read-aloud."""
import io
import math
import os
import re
import textwrap
import threading
import wave
from pathlib import Path

from install_conversation_models import MODEL_DIR
from voice_errors import SpeechError

NIGERIAN_LOCALES = ("en-NG", "pcm-NG")
FEMALE_STYLES = {"ada", "chidi", "zainab"}


def wave_clip(pcm):
    stream = io.BytesIO()
    with wave.open(stream, "wb") as wav:
        wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    return stream.getvalue()


class NigerianSpeech:
    def __init__(self, root):
        import torch
        from transformers import VitsModel, VitsTokenizer

        # VITS plans the prosody of the full phrase before decoding its waveform.
        # Use its returned spectrogram and run the original HiFi-GAN decoder a
        # window at a time so the phone can play the first audio immediately.
        class ReturnSpectrogram(torch.nn.Module):
            def forward(self, spectrogram, speaker_embeddings=None):
                return spectrogram

        available = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else os.cpu_count() or 1
        torch.set_num_threads(min(8, available))
        selected = os.getenv("PADI_NIGERIAN_VOICE_DEVICE", "auto")
        if selected not in ("auto", "cpu", "cuda", "mps", "vulkan"):
            raise ValueError("PADI_NIGERIAN_VOICE_DEVICE must be auto, cpu, cuda, mps or vulkan")
        gpu = None
        vulkan_ready = all((root / f"naija-{gender}/vulkan-decoder-v1/decoder.bin").is_file() for gender in ("male", "female"))
        if selected == "auto":
            selected = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
            if selected == "cpu" and vulkan_ready:
                from vulkan_speech import hardware_gpu
                gpu = hardware_gpu()
        elif selected == "vulkan":
            from vulkan_speech import hardware_gpu
            gpu = hardware_gpu()
            if gpu is None or not vulkan_ready:
                raise ValueError("Vulkan speech needs a hardware GPU and the models from npm run setup:voice -- --vulkan")
        self.device = torch.device("cpu" if selected == "vulkan" else selected)
        self.lock = threading.Lock()
        self.voices = {}
        for gender in ("male", "female"):
            directory = root / ("naija-" + gender)
            tokenizer = VitsTokenizer.from_pretrained(directory, local_files_only=True)
            model = VitsModel.from_pretrained(directory, local_files_only=True, use_safetensors=True).eval().to(self.device)
            decoder = model.decoder
            model.decoder = ReturnSpectrogram()
            if gpu is not None:
                from vulkan_speech import VulkanDecoder
                decoder = VulkanDecoder(directory / "vulkan-decoder-v1", gpu)
            self.voices[gender] = tokenizer, model, decoder

    def chunks(self, text, style, pace):
        import numpy as np
        import torch
        from num2words import num2words

        tokenizer, model, decoder = self.voices["female" if style in FEMALE_STYLES else "male"]
        # The checkpoint's alphabet omits several digits. Expand ordinary
        # numbers for pronunciation and keep the displayed text verbatim.
        words = re.sub(r"\b\d{1,15}(?:\.\d{1,6})?\b", lambda match: num2words(match.group()), text)
        # Keep large read-aloud requests bounded without truncating their text.
        passages = textwrap.wrap(" ".join(words.split()), width=220, break_on_hyphens=False)
        with torch.inference_mode():
            hop = math.prod(model.config.upsample_rates)
            for passage in passages:
                ids = tokenizer(passage, return_tensors="pt").input_ids.to(self.device)
                if ids.shape[1] < 2:
                    continue
                with self.lock:
                    model.speaking_rate = pace
                    spectrogram = model(ids).spectrogram
                frames = spectrogram.shape[-1]
                offset = 0
                while offset < frames:
                    end = min(frames, offset + (8 if offset == 0 else 64))
                    # The convolutional vocoder needs neighbouring frames at
                    # each seam. Decode the context and play each sample once.
                    left, right = max(0, offset - 16), min(frames, end + 16)
                    with self.lock:
                        audio = decoder(spectrogram[:, :, left:right]).reshape(-1).cpu().numpy()
                    first, last = (offset - left) * hop, (end - left) * hop
                    positions = np.arange(first * 3 // 2, last * 3 // 2) * (2.0 / 3.0)
                    resampled = np.interp(positions, np.arange(len(audio)), audio)
                    yield (np.clip(resampled, -1, 1) * 32767).astype("<i2").tobytes()
                    offset = end


def voice_root():
    return Path(os.getenv("PADI_NIGERIAN_VOICE_DIR") or MODEL_DIR)


def voices_installed():
    return all((voice_root() / f"naija-{gender}" / "model.safetensors").is_file() for gender in ("male", "female"))


_engine = None
_load = threading.Lock()


def nigerian_engine():
    global _engine
    with _load:
        if _engine is None:
            if not voices_installed():
                raise SpeechError(503, "nigerian_voices_not_installed")
            _engine = NigerianSpeech(voice_root())
    return _engine
