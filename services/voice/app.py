"""PADI's private Python speech service. Run behind the authenticated Go API.

No audio, text, or credentials are logged or persisted. Python owns expressive
speech synthesis; Go owns authentication, memory, consent, and usage accounting.
Uses the standard library so the development service needs no heavyweight AI SDK.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import io
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.request
import wave
from email.message import Message
from email.parser import BytesParser
from email import policy
from array import array
import math
import sys
import time
import uuid

import webrtcvad
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logger = logging.getLogger("padi.voice")

LEGACY_MODEL = "gemini-3.1-flash-tts-preview"
FALLBACK_VOICE_MODEL = "gemini-2.5-flash-preview-tts"
LEGACY_MODELS = frozenset((LEGACY_MODEL, FALLBACK_VOICE_MODEL))
NATURAL_MODEL = "gemini-3.8-flash-tts"
NATURAL_MODELS = frozenset((NATURAL_MODEL, "gemini-3.8-flash-lite-tts"))
MODEL = os.environ.get("PADI_VOICE_MODEL", LEGACY_MODEL)
FALLBACK_MODEL = os.environ.get("PADI_VOICE_FALLBACK_MODEL", FALLBACK_VOICE_MODEL if MODEL != FALLBACK_VOICE_MODEL else "")
DEFAULT_VOICE_ID = os.environ.get("PADI_VOICE_DEFAULT_ID", "")
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_TEXT_BYTES = 8192
FAST_MODEL = "canopylabs/orpheus-v1-english"
GROQ_VOICES = {"baby":"troy", "ada":"hannah", "chidi":"autumn", "zainab":"diana", "tunde":"austin", "amara":"daniel"}
VOICE_STYLES = {
    # Keep the stored default ID so existing preferences continue to work.
    "baby": ("Orus", "a full, resonant adult male voice, confident, charismatic and warm"),
    "ada": ("Sulafat", "warm, relaxed, friendly and thoughtful"),
    "chidi": ("Achird", "calm, friendly and reassuring"),
    "zainab": ("Laomedeia", "bright and encouraging"),
    "tunde": ("Zubenelgenubi", "relaxed and conversational"),
    "amara": ("Vindemiatrix", "gentle, soft and thoughtful"),
}
LANGUAGE_DELIVERY = {
    "en-NG": "Speak English with a natural Nigerian English accent and everyday Nigerian cadence.",
    "pcm-NG": "Speak the provided Nigerian Pidgin with natural Naija pronunciation, rhythm and emphasis.",
    "en-GB": "Use natural English pronunciation and conversational rhythm.",
    "fr-FR": "Use natural French pronunciation and conversational rhythm.",
    "pt-BR": "Use natural Brazilian Portuguese pronunciation and conversational rhythm.",
    "es-ES": "Use natural Spanish pronunciation and conversational rhythm.",
    "ar-SA": "Use natural Arabic pronunciation and conversational rhythm.",
    "sw-KE": "Use natural Swahili pronunciation and conversational rhythm.",
    "ha-NG": "Use natural Nigerian Hausa pronunciation and conversational rhythm.",
    "yo-NG": "Use natural Yoruba pronunciation, respecting its tones and conversational rhythm.",
    "ig-NG": "Use natural Igbo pronunciation, respecting its tones and conversational rhythm.",
    "am-ET": "Use natural Amharic pronunciation and conversational rhythm.",
    "hi-IN": "Use natural Hindi pronunciation and conversational rhythm.",
    "zh-CN": "Use natural Mandarin pronunciation, respecting its tones and conversational rhythm.",
}


class SpeechError(Exception):
    def __init__(self, status: int, code: str, retry_after_seconds: int = 0):
        super().__init__(code)
        self.status = status
        self.code = code
        self.retry_after_seconds = retry_after_seconds


def speech_payload(text: str, style: str, rate: float, language: str = "en-NG", model: str = MODEL, default_voice_id: str = "") -> dict:
    voice, delivery = VOICE_STYLES[style]
    pace = "comfortable" if 0.95 <= rate <= 1.05 else "slightly slower" if rate < 0.95 else "slightly quicker"
    language_guard = (
        "Speak in English. Do not translate the transcript or add words in another language. "
        "Keep names and explicitly quoted foreign words as written. "
        if language in ("en-NG", "en-GB") else
        "Stay in the selected language. Do not translate the transcript or switch languages on your own. "
    )
    if model in NATURAL_MODELS:
        if style == "baby":
            voice = default_voice_id or voice
            delivery = "warm, confident, relaxed and expressive"
        # The newer model speaks text verbatim. Directions belong in metadata,
        # otherwise profile headings and instructions can be read aloud.
        return {
            "contents": [{"parts": [{
                "text": text,
                "speech_metadata": {"style": (
                    f"{delivery}. {LANGUAGE_DELIVERY[language]} {language_guard}"
                    f"{pace.capitalize()} conversational pace, connected phrasing and naturally varied emphasis. "
                    "Match the emotional tone of the words."
                )},
            }]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        }
    if model not in LEGACY_MODELS or default_voice_id:
        raise SpeechError(400, "invalid_speech_configuration")
    instructions = (
        "AUDIO PROFILE: PADI, an original personal companion.\n"
        f"Voice character: {delivery}. Keep this voice's normal pitch.\n"
        "SCENE: A friendly, spontaneous conversation with one person, close and comfortable.\n"
        "DIRECTOR'S NOTES:\n"
        f"{LANGUAGE_DELIVERY[language]} {language_guard}"
        f"Use a {pace} conversational pace. Connect words into flowing phrases rather than pronouncing "
        "each word separately. Vary pitch, emphasis and timing with the meaning. Give important words "
        "clear, confident emphasis; let sentence endings settle naturally. Use brief, purposeful pauses "
        "and easy breaths. Sound engaged and expressive when the words are playful or positive; "
        "be gentle and grounded when they are serious or sensitive. Keep energy warm and believable. "
        "Avoid a flat robotic rhythm, a formal recital, a broadcast voice, shouting, or a caricature of an accent. "
        "Keep PADI's own identity; do not imitate or impersonate a real person. "
        "Speak only the transcript below, faithfully, including names and numbers. "
        "Do not add filler words, laughs, sound effects or these directions.\n"
        "TRANSCRIPT:\n" + text
    )
    return {
        "contents": [{"parts": [{"text": instructions}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }


def decode_audio(result: dict) -> dict:
    candidates = result.get("candidates", [])
    if not isinstance(candidates, list) or not candidates:
        raise SpeechError(502, "empty_speech")
    parts = candidates[0].get("content", {}).get("parts", [])
    inline = next((part.get("inlineData") for part in parts if part.get("inlineData")), None)
    mime = Message()
    mime["Content-Type"] = inline.get("mimeType", "") if isinstance(inline, dict) else ""
    if not isinstance(inline, dict) or mime.get_content_type().lower() not in ("audio/l16", "audio/wav"):
        raise SpeechError(502, "invalid_speech_audio")
    try:
        decoded = base64.b64decode(inline.get("data", ""), validate=True)
    except (binascii.Error, ValueError, TypeError):
        raise SpeechError(502, "invalid_speech_audio") from None
    if not decoded or len(decoded) > MAX_AUDIO_BYTES:
        raise SpeechError(502, "invalid_speech_audio")
    if mime.get_content_type().lower() == "audio/l16":
        if mime.get_param("rate") != "24000" or mime.get_param("channels", "1") != "1" or mime.get_param("codec", "pcm") != "pcm":
            raise SpeechError(502, "invalid_speech_audio")
        pcm = decoded
    else:
        try:
            with wave.open(io.BytesIO(decoded), "rb") as wav:
                if wav.getframerate() != 24000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getcomptype() != "NONE" or wav.getnframes() * 2 > MAX_AUDIO_BYTES - 44:
                    raise SpeechError(502, "invalid_speech_audio")
                pcm = wav.readframes(wav.getnframes())
                if len(pcm) != wav.getnframes() * 2:
                    raise SpeechError(502, "invalid_speech_audio")
        except (wave.Error, EOFError):
            raise SpeechError(502, "invalid_speech_audio") from None
    if not pcm or len(pcm) % 2 or len(pcm) > MAX_AUDIO_BYTES - 44:
        raise SpeechError(502, "invalid_speech_audio")
    # Canonical PCM WAV keeps Go and both app playback paths unchanged.
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(pcm)
    usage = result.get("usageMetadata", {})
    input_tokens = usage.get("promptTokenCount", 0)
    audio_tokens = usage.get("candidatesTokenCount", 0)
    if any(type(value) is not int or not 0 <= value <= 1_000_000 for value in (input_tokens, audio_tokens)):
        raise SpeechError(502, "invalid_speech_usage")
    return {
        "audio_base64": base64.b64encode(out.getvalue()).decode("ascii"),
        "mime_type": "audio/wav", "input_tokens": input_tokens, "audio_tokens": audio_tokens,
    }


def synthesise(key: str, text: str, style: str, rate: float, language: str = "en-NG", model: str = MODEL) -> dict:
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(speech_payload(text, style, rate, language, model, DEFAULT_VOICE_ID if model in NATURAL_MODELS else "")).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key, "User-Agent": "MyPADI-Voice/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read(12 * 1024 * 1024 + 1)
            if len(data) > 12 * 1024 * 1024:
                raise SpeechError(502, "invalid_speech_audio")
        return decode_audio(json.loads(data))
    except urllib.error.HTTPError as error:
        retry_after = 60
        if error.code == 429:
            try:
                details = json.loads(error.read(64 * 1024)).get("error", {}).get("details", [])
                delays = [item.get("retryDelay", "") for item in details if isinstance(item, dict)]
                for delay in delays:
                    if isinstance(delay, str) and re.fullmatch(r"\d+(?:\.\d+)?s", delay):
                        retry_after = math.ceil(max(1, min(86400, float(delay[:-1]))))
                        break
            except (ValueError, TypeError, AttributeError):
                pass
        raise SpeechError(429 if error.code == 429 else 502, "speech_rate_limited" if error.code == 429 else "speech_unavailable", retry_after if error.code == 429 else 0) from None
    except (urllib.error.URLError, TimeoutError):
        raise SpeechError(504, "speech_timeout") from None
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError):
        raise SpeechError(502, "invalid_speech_response") from None


def prepare_audio(audio: bytes) -> bytes:
    """Detect actual speech, trim idle audio, reduce DC/low-frequency rumble,
    and convert microphone PCM to Whisper's 16 kHz mono input format."""
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav:
            rate = wav.getframerate()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or not 8000 <= rate <= 96000 or wav.getnframes() / rate > 60:
                raise SpeechError(400, "invalid_audio")
            raw = wav.readframes(wav.getnframes())
    except (wave.Error, EOFError):
        raise SpeechError(400, "invalid_audio") from None
    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        raise SpeechError(422, "no_speech")
    if rate != 16000:
        converted = array("h")
        for index in range(int(len(samples) * 16000 / rate)):
            position = index * rate / 16000
            start = int(position)
            fraction = position - start
            converted.append(round(samples[start] * (1-fraction) + samples[min(start+1, len(samples)-1)] * fraction))
        samples = converted
    # High-pass filter at approximately 80 Hz; never amplify a silent recording.
    alpha = math.exp(-2 * math.pi * 80 / 16000)
    previous = 0.0
    filtered = 0.0
    for index, sample in enumerate(samples):
        filtered = alpha * (filtered + sample - previous)
        previous = sample
        samples[index] = max(-32768, min(32767, round(filtered)))
    if sys.byteorder != "little":
        samples.byteswap()
    pcm = samples.tobytes()
    detector = webrtcvad.Vad(2)
    frame_size = 640  # 20 ms of 16 kHz, 16-bit mono.
    speech = [offset for offset in range(0, len(pcm)-frame_size+1, frame_size) if detector.is_speech(pcm[offset:offset+frame_size], 16000)]
    if len(speech) < 3:
        raise SpeechError(422, "no_speech")
    start = max(0, speech[0]-16000)  # Include half a second of lead-in.
    end = min(len(pcm), speech[-1]+frame_size+16000)
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes(pcm[start:end])
    return out.getvalue()


def normalise_speech_wave(raw: bytes) -> dict:
    """Keep generated speech intact while normalizing the provider WAV format."""
    if len(raw) > MAX_AUDIO_BYTES:
        raise SpeechError(502, "invalid_speech_audio")
    # Groq delivers a completed streaming WAV whose RIFF/data lengths are
    # 0xffffffff (unknown until EOF). Python's wave reader treats that as an
    # enormous frame count. Repair only this explicit streaming format after
    # the bounded HTTP response completes; ordinary truncated WAVs still fail.
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WAVE" and raw[4:8] == b"\xff" * 4:
        repaired = bytearray(raw)
        offset = 12
        while offset + 8 <= len(raw):
            length = int.from_bytes(raw[offset + 4:offset + 8], "little")
            if raw[offset:offset + 4] == b"data" and length == 0xffffffff:
                available = len(raw) - offset - 8
                if not available or available % 2:
                    raise SpeechError(502, "invalid_speech_audio")
                repaired[offset + 4:offset + 8] = available.to_bytes(4, "little")
                repaired[4:8] = (len(raw) - 8).to_bytes(4, "little")
                raw = bytes(repaired)
                break
            if length > len(raw) - offset - 8:
                raise SpeechError(502, "invalid_speech_audio")
            offset += 8 + length + length % 2
        else:
            raise SpeechError(502, "invalid_speech_audio")
    try:
        with wave.open(io.BytesIO(raw), "rb") as wav:
            rate = wav.getframerate()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getcomptype() != "NONE" or not 8000 <= rate <= 96000 or wav.getnframes() * 2 > MAX_AUDIO_BYTES - 44:
                raise SpeechError(502, "invalid_speech_audio")
            frames = wav.getnframes()
            pcm = wav.readframes(frames)
            if not pcm or len(pcm) != frames * 2:
                raise SpeechError(502, "invalid_speech_audio")
    except (wave.Error, EOFError):
        raise SpeechError(502, "invalid_speech_audio") from None
    if rate != 24000:
        samples = array("h")
        samples.frombytes(pcm)
        if sys.byteorder != "little": samples.byteswap()
        count = int(len(samples) * 24000 / rate)
        if count * 2 > MAX_AUDIO_BYTES - 44: raise SpeechError(502, "invalid_speech_audio")
        converted = array("h")
        for index in range(count):
            position = index * rate / 24000
            start, fraction = int(position), position - int(position)
            converted.append(round(samples[start] * (1 - fraction) + samples[min(start + 1, len(samples) - 1)] * fraction))
        if sys.byteorder != "little": converted.byteswap()
        pcm = converted.tobytes()
    return decode_audio({"candidates":[{"content":{"parts":[{"inlineData":{
        "mimeType":"audio/l16;rate=24000", "data":base64.b64encode(pcm).decode("ascii")
    }}]}}]})


def synthesise_groq(key: str, text: str, style: str) -> dict:
    request = urllib.request.Request("https://api.groq.com/openai/v1/audio/speech",
        data=json.dumps({"model":FAST_MODEL, "input":text, "voice":GROQ_VOICES[style], "response_format":"wav"}).encode(),
        headers={"Authorization":"Bearer " + key, "Content-Type":"application/json", "User-Agent":"MyPADI-Voice/1.0"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(MAX_AUDIO_BYTES + 1)
        if len(raw) > MAX_AUDIO_BYTES: raise SpeechError(502, "invalid_speech_audio")
        return normalise_speech_wave(raw)
    except urllib.error.HTTPError as error:
        code = "speech_unavailable"
        if error.code == 429: code = "speech_rate_limited"
        elif error.code in (400, 403):
            try:
                detail = json.loads(error.read(64 * 1024)).get("error", {}).get("code")
                if detail == "model_terms_required": code = "speech_terms_required"
            except (ValueError, TypeError, AttributeError): pass
        raise SpeechError(429 if error.code == 429 else 400 if code == "speech_terms_required" else 502, code, 60 if error.code == 429 else 0) from None
    except (urllib.error.URLError, TimeoutError):
        raise SpeechError(504, "speech_timeout") from None


def recognise(key: str, audio: bytes, language: str = "en", prompt: str = "") -> dict:
    audio = prepare_audio(audio)
    boundary = "padi-" + uuid.uuid4().hex
    body = bytearray()
    fields = {"model": "whisper-large-v3-turbo", "response_format": "verbose_json", "temperature": "0"}
    if language:
        if language not in ("en", "fr", "pt", "es", "ar", "sw", "ha", "yo", "am", "hi", "zh"):
            raise SpeechError(400, "invalid_language")
        fields["language"] = language
    if prompt:
        fields["prompt"] = prompt
    for name, value in fields.items():
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode())
    body.extend(audio); body.extend(f'\r\n--{boundary}--\r\n'.encode())
    request = urllib.request.Request("https://api.groq.com/openai/v1/audio/transcriptions", data=bytes(body), headers={"Authorization": "Bearer "+key, "Content-Type": "multipart/form-data; boundary="+boundary, "User-Agent": "MyPADI-Voice/1.0"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            data = response.read(64*1024+1)
        if len(data)>64*1024:
            raise SpeechError(502,"invalid_transcription")
        result = json.loads(data)
        text = result.get("text")
        if not isinstance(text,str) or not text.strip():
            raise SpeechError(422,"no_speech")
        text = text.strip()
        if len(text.encode())>MAX_TEXT_BYTES:
            raise SpeechError(502,"invalid_transcription")
        result["text"] = text
        return result
    except urllib.error.HTTPError as error:
        raise SpeechError(429 if error.code==429 else 502,"speech_rate_limited" if error.code==429 else "transcription_unavailable") from None
    except (urllib.error.URLError,TimeoutError):
        raise SpeechError(504,"speech_timeout") from None
    except (json.JSONDecodeError,AttributeError):
        raise SpeechError(502,"invalid_transcription") from None


def make_handler(token: str, key: str, generate=synthesise, groq_key="", transcribe=recognise):
    slots = threading.BoundedSemaphore(4)
    disable_limits = os.environ.get("PADI_DISABLE_ALL_LIMITS", "").lower() == "true"

    class Handler(BaseHTTPRequestHandler):
        # Default HTTP logging contains request paths. Keep this service silent.
        def log_message(self, *_args):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def respond(self, status: int, value: dict):
            body = json.dumps(value).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Go/client cancelled; never log the discarded content.

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"service": "padi-python-voice", "status": "ready"})
            else:
                self.respond(404, {"error": "not_found"})

        def do_POST(self):
            if self.path not in ("/synthesise", "/transcribe"):
                self.respond(404, {"error": "not_found"})
                return
            started = time.monotonic()
            endpoint = self.path.removeprefix("/")
            if not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf8"), ("Bearer " + token).encode("utf8")):
                logger.warning("voice request endpoint=%s status=401 error=unauthenticated", endpoint)
                self.respond(401, {"error": "unauthenticated"})
                return
            if self.path == "/transcribe":
                try:
                    length=int(self.headers.get("Content-Length","0"))
                    if not 0<length<=MAX_AUDIO_BYTES+4096 or self.headers.get("Transfer-Encoding"):
                        raise SpeechError(400,"invalid_audio")
                    raw=self.rfile.read(length)
                    if len(raw)!=length:
                        raise SpeechError(400,"invalid_audio")
                    header=self.headers.get("Content-Type", "")
                    message=BytesParser(policy=policy.default).parsebytes(("Content-Type: "+header+"\r\nMIME-Version: 1.0\r\n\r\n").encode()+raw)
                    if not message.is_multipart():
                        raise SpeechError(400,"invalid_audio")
                    parts=list(message.iter_parts())
                    files=[part for part in parts if part.get_param("name",header="content-disposition")=="file"]
                    if len(files)!=1:
                        raise SpeechError(400,"invalid_audio")
                    audio=files[0].get_payload(decode=True)
                    if not isinstance(audio,bytes) or len(audio)>MAX_AUDIO_BYTES:
                        raise SpeechError(400,"invalid_audio")
                    def field(name, default):
                        values = [part for part in parts if part.get_param("name", header="content-disposition") == name]
                        if len(values) > 1:
                            raise SpeechError(400,"invalid_audio")
                        if not values:
                            return default
                        value = values[0].get_payload(decode=True)
                        if not isinstance(value,bytes) or len(value)>512:
                            raise SpeechError(400,"invalid_audio")
                        return value.decode("utf8")
                    language, prompt = field("language", "en"), field("prompt", "")
                    if language not in ("", "en", "fr", "pt", "es", "ar", "sw", "ha", "yo", "am", "hi", "zh"):
                        raise SpeechError(400,"invalid_language")
                    if not disable_limits and not slots.acquire(blocking=False):
                        logger.warning("voice request endpoint=transcribe provider=groq status=429 error=speech_busy")
                        raise SpeechError(429,"speech_busy")
                    try:
                        result = transcribe(groq_key,audio,language=language,prompt=prompt)
                        logger.info("voice request endpoint=transcribe provider=groq model=whisper-large-v3-turbo status=200 duration_ms=%d", int((time.monotonic()-started)*1000))
                        self.respond(200,result)
                    finally:
                        if not disable_limits:
                            slots.release()
                except SpeechError as error:
                    logger.warning("voice request endpoint=transcribe provider=groq status=%d error=%s duration_ms=%d", error.status, error.code, int((time.monotonic()-started)*1000))
                    self.respond(error.status,{"error":error.code})
                except Exception as error:
                    logger.error("voice request endpoint=transcribe status=400 error=invalid_audio exception=%s", type(error).__name__)
                    self.respond(400,{"error":"invalid_audio"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 64 * 1024 or self.headers.get("Transfer-Encoding"):
                    raise ValueError()
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError()
                body = json.loads(raw)
                if not isinstance(body, dict) or set(body) - {"text", "style", "rate", "language", "model"}:
                    raise ValueError()
                text, style, rate = body.get("text"), body.get("style", "ada"), body.get("rate", 1.0)
                language = body.get("language", "en-NG")
                model = body.get("model", MODEL)
                if not isinstance(model, str) or model not in (MODEL, FALLBACK_MODEL, FAST_MODEL) or not model:
                    raise ValueError()
                if not isinstance(text, str) or not text.strip() or len(text.encode()) > MAX_TEXT_BYTES:
                    raise ValueError()
                if not isinstance(style, str) or style not in VOICE_STYLES or type(rate) not in (int, float) or not 0.5 <= rate <= 1.5:
                    raise ValueError()
                if not isinstance(language, str) or language not in LANGUAGE_DELIVERY:
                    raise ValueError()
                if model == FAST_MODEL and (rate != 1 or language not in ("en-NG", "en-GB", "pcm-NG")):
                    raise ValueError()
            except (ValueError, TypeError, UnicodeError, TimeoutError):
                logger.warning("voice request endpoint=synthesise status=400 error=invalid_request")
                self.respond(400, {"error": "invalid_request"})
                return
            if not disable_limits and not slots.acquire(blocking=False):
                logger.warning("voice request endpoint=synthesise status=429 error=speech_busy")
                self.respond(429, {"error": "speech_busy"})
                return
            try:
                provider = "groq" if model == FAST_MODEL else "gemini"
                if model == FAST_MODEL:
                    result = synthesise_groq(groq_key, text, style)
                else:
                    result = generate(key, text, style, rate, language) if model == MODEL else generate(key, text, style, rate, language, model=model)
                logger.info("voice request endpoint=synthesise provider=%s model=%s status=200 duration_ms=%d", provider, model or MODEL, int((time.monotonic()-started)*1000))
                self.respond(200, result)
            except SpeechError as error:
                logger.warning("voice request endpoint=synthesise provider=%s model=%s status=%d error=%s duration_ms=%d", provider, model or MODEL, error.status, error.code, int((time.monotonic()-started)*1000))
                self.respond(error.status, {"error": error.code, "retry_after_seconds": error.retry_after_seconds})
            except Exception as error:
                logger.error("voice request endpoint=synthesise provider=%s model=%s status=502 error=speech_unavailable exception=%s", provider, model or MODEL, type(error).__name__)
                self.respond(502, {"error": "speech_unavailable"})
            finally:
                if not disable_limits:
                    slots.release()

    return Handler


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stdout)
    if MODEL not in LEGACY_MODELS and MODEL not in NATURAL_MODELS:
        raise SystemExit("Choose a verified, supported PADI voice model.")
    if FALLBACK_MODEL and FALLBACK_MODEL not in LEGACY_MODELS and FALLBACK_MODEL not in NATURAL_MODELS:
        raise SystemExit("Choose a supported PADI fallback voice model.")
    if DEFAULT_VOICE_ID and (MODEL not in NATURAL_MODELS or re.fullmatch(r"voice_[A-Za-z0-9_-]+", DEFAULT_VOICE_ID) is None):
        raise SystemExit("The original PADI voice profile requires the newer speech model and a valid voice ID.")
    token = os.environ.get("PADI_VOICE_SERVICE_TOKEN", "")
    key = os.environ.get("GEMINI_API_KEY", "")
    groq_key=os.environ.get("GROQ_API_KEY", "")
    confirmed=os.environ.get("PADI_AI_FREE_ACCOUNT_CONFIRMED", "").split(",")
    if len(token) < 32 or not key or not groq_key or "gemini" not in confirmed or "groq" not in confirmed:
        raise SystemExit("Python voice requires an internal token, Gemini/Groq credentials, and confirmed free-tier use.")
    port = int(os.environ.get("PADI_PYTHON_VOICE_PORT", "8090"))
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(token, key,groq_key=groq_key))
    server.daemon_threads = True
    logger.info("voice service ready host=127.0.0.1 port=%d primary_model=%s fallback_model=%s gemini_key_configured=%s groq_key_configured=%s limits_disabled=%s",
        port, MODEL, FALLBACK_MODEL or "none", bool(key), bool(groq_key), os.environ.get("PADI_DISABLE_ALL_LIMITS", "").lower() == "true")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
