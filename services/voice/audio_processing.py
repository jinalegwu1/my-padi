"""Bounded container validation, decoding and speech preparation; no recognition."""
from array import array
from dataclasses import dataclass
import io
import math
from pathlib import Path
import sys
import wave

import av
import webrtcvad

from voice_errors import SpeechError
from audio_containers import validate_webm_file, validate_mp4_file

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_SECONDS = 60
SAMPLE_RATE = 16000


@dataclass
class DecodedAudio:
    wav: bytes
    codec: str
    container: str
    duration_seconds: float
    pcm_bytes: int


def decode_audio_file(path: str, mime: str) -> DecodedAudio:
    size = Path(path).stat().st_size
    if size == 0:
        raise SpeechError(400, "empty_audio")
    if size > MAX_AUDIO_BYTES:
        raise SpeechError(413, "audio_too_large")
    with open(path, "rb") as source:
        header = source.read(12)
    media = mime.partition(";")[0].strip().lower()
    if header[:4] == b"\x1a\x45\xdf\xa3" and media == "audio/webm":
        validate_webm_file(path, size)
        kind, codecs = "webm", ("opus",)
    elif header[4:8] == b"ftyp" and media in ("audio/mp4", "audio/x-m4a"):
        validate_mp4_file(path, size)
        kind, codecs = "mp4", ("aac",)
    elif header[:4] == b"RIFF" and header[8:12] == b"WAVE" and media in ("audio/wav", "audio/x-wav"):
        kind, codecs = "wav", ("pcm_s16le",)
        try:
            with wave.open(path, "rb") as wav:
                if wav.getnframes() / wav.getframerate() > MAX_SECONDS + 0.1:
                    raise SpeechError(422, "audio_too_long")
                if len(wav.readframes(wav.getnframes())) != wav.getnframes() * wav.getnchannels() * wav.getsampwidth():
                    raise SpeechError(400, "invalid_audio")
        except (wave.Error, EOFError, ZeroDivisionError):
            raise SpeechError(400, "invalid_audio") from None
    else:
        raise SpeechError(415, "unsupported_audio_format")
    parts, samples = [], 0
    try:
        # Restrict the demuxer and disable external data references. A supplied
        # container must never fetch network resources or another local file.
        with av.open(path, mode="r", format=kind, options={"err_detect": "explode", "protocol_whitelist": "file", "enable_drefs": "0"}) as container:
            if len(container.streams.audio) != 1 or len(container.streams) != 1:
                raise SpeechError(400, "invalid_audio")
            stream = container.streams.audio[0]
            codec = stream.codec_context.name
            if codec not in codecs:
                raise SpeechError(415, "unsupported_audio_codec")
            if not 8000 <= stream.codec_context.sample_rate <= 96000 or not 1 <= stream.codec_context.channels <= 2:
                raise SpeechError(400, "invalid_audio")
            if container.duration and container.duration / av.time_base > MAX_SECONDS + 0.1:
                raise SpeechError(422, "audio_too_long")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)

            def collect(frames):
                nonlocal samples
                for frame in frames:
                    samples += frame.samples
                    if samples > int((MAX_SECONDS + 0.1) * SAMPLE_RATE):
                        raise SpeechError(422, "audio_too_long")
                    parts.append(frame.to_ndarray().astype('<i2', copy=False).tobytes())

            for packet in container.demux(stream):
                if packet.is_corrupt:
                    raise SpeechError(400, "invalid_audio")
                for frame in packet.decode():
                    collect(resampler.resample(frame))
            collect(resampler.resample(None))
    except SpeechError:
        raise
    except (av.error.FFmpegError, ValueError, OverflowError, OSError):
        raise SpeechError(400, "invalid_audio") from None
    if not samples:
        raise SpeechError(400, "empty_audio")
    pcm = b"".join(parts)
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return DecodedAudio(out.getvalue(), codec, kind, samples / SAMPLE_RATE, len(pcm))


def prepare_audio(audio: bytes) -> bytes:
    """Preserve the existing rumble filter, WebRTC VAD and 500 ms trim margins."""
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav:
            rate = wav.getframerate()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or not 8000 <= rate <= 96000 or wav.getnframes() / rate > MAX_SECONDS + 0.1:
                raise SpeechError(400, "invalid_audio")
            raw = wav.readframes(wav.getnframes())
            if len(raw) != wav.getnframes() * 2:
                raise SpeechError(400, "invalid_audio")
    except (wave.Error, EOFError):
        raise SpeechError(400, "invalid_audio") from None
    values = array("h", raw)
    if sys.byteorder != "little":
        values.byteswap()
    if not values:
        raise SpeechError(422, "no_speech")
    if rate != SAMPLE_RATE:
        # Compatibility for callers of the existing PCM preparation function.
        converted = array("h")
        for index in range(int(len(values) * SAMPLE_RATE / rate)):
            position = index * rate / SAMPLE_RATE
            start, fraction = int(position), position % 1
            converted.append(round(values[start] * (1 - fraction) + values[min(start + 1, len(values) - 1)] * fraction))
        values = converted
    alpha, previous, filtered = math.exp(-2 * math.pi * 80 / SAMPLE_RATE), 0.0, 0.0
    for index, sample in enumerate(values):
        filtered = alpha * (filtered + sample - previous)
        previous = sample
        values[index] = max(-32768, min(32767, round(filtered)))
    if sys.byteorder != "little":
        values.byteswap()
    pcm = values.tobytes()
    detector = webrtcvad.Vad(2)
    frame_size = 640
    speech = [offset for offset in range(0, len(pcm) - frame_size + 1, frame_size) if detector.is_speech(pcm[offset:offset + frame_size], SAMPLE_RATE)]
    if len(speech) < 3:
        raise SpeechError(422, "no_speech")
    start, end = max(0, speech[0] - 16000), min(len(pcm), speech[-1] + frame_size + 16000)
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm[start:end])
    return out.getvalue()
