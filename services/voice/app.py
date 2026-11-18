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
import os
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
import uuid

import webrtcvad
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "gemini-3.1-flash-tts-preview"
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_TEXT_BYTES = 8192
VOICE_STYLES = {
    "baby": ("Zephyr", "bright and gently playful, with a natural adult voice; do not imitate a child"),
    "ada": ("Sulafat", "warm, relaxed, friendly and thoughtful"),
    "chidi": ("Achird", "calm, friendly and reassuring"),
    "zainab": ("Laomedeia", "bright and encouraging"),
    "tunde": ("Zubenelgenubi", "relaxed and conversational"),
    "amara": ("Vindemiatrix", "gentle, soft and thoughtful"),
    "daniel": ("Schedar", "steady, clear and reassuring"),
}


class SpeechError(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


def speech_payload(text: str, style: str, rate: float) -> dict:
    voice, delivery = VOICE_STYLES[style]
    pace = "comfortable" if 0.95 <= rate <= 1.05 else "slightly slower" if rate < 0.95 else "slightly quicker"
    instructions = (
        f"Read the transcript verbatim. Sound {delivery}, like a friend in a real conversation. "
        f"Use a {pace} conversational pace, natural breath and pauses, varied intonation, and a normal pitch. "
        "Match the language and emotional tone of the transcript. Do not add words, laughs, filler, "
        "sound effects, or an exaggerated accent. Do not read these directions aloud.\n"
        "TRANSCRIPT (words to speak):\n" + text
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
    if not isinstance(inline, dict) or mime.get_content_type().lower() != "audio/l16" or mime.get_param("rate") != "24000" or mime.get_param("channels", "1") != "1" or mime.get_param("codec", "pcm") != "pcm":
        raise SpeechError(502, "invalid_speech_audio")
    try:
        pcm = base64.b64decode(inline.get("data", ""), validate=True)
    except (binascii.Error, ValueError, TypeError):
        raise SpeechError(502, "invalid_speech_audio") from None
    if not pcm or len(pcm) % 2 or len(pcm) > MAX_AUDIO_BYTES - 44:
        raise SpeechError(502, "invalid_speech_audio")
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


def synthesise(key: str, text: str, style: str, rate: float) -> dict:
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(speech_payload(text, style, rate)).encode(),
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
        raise SpeechError(429 if error.code == 429 else 502, "speech_rate_limited" if error.code == 429 else "speech_unavailable") from None
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


def recognise(key: str, audio: bytes) -> dict:
    audio = prepare_audio(audio)
    boundary = "padi-" + uuid.uuid4().hex
    body = bytearray()
    for name, value in {"model": "whisper-large-v3-turbo", "response_format": "verbose_json", "temperature": "0"}.items():
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
            if not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf8"), ("Bearer " + token).encode("utf8")):
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
                    if not slots.acquire(blocking=False):
                        raise SpeechError(429,"speech_busy")
                    try:
                        self.respond(200,transcribe(groq_key,audio))
                    finally:
                        slots.release()
                except SpeechError as error:
                    self.respond(error.status,{"error":error.code})
                except Exception:
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
                if not isinstance(body, dict) or set(body) - {"text", "style", "rate"}:
                    raise ValueError()
                text, style, rate = body.get("text"), body.get("style", "ada"), body.get("rate", 1.0)
                if not isinstance(text, str) or not text.strip() or len(text.encode()) > MAX_TEXT_BYTES:
                    raise ValueError()
                if not isinstance(style, str) or style not in VOICE_STYLES or type(rate) not in (int, float) or not 0.5 <= rate <= 1.5:
                    raise ValueError()
            except (ValueError, TypeError, UnicodeError, TimeoutError):
                self.respond(400, {"error": "invalid_request"})
                return
            if not slots.acquire(blocking=False):
                self.respond(429, {"error": "speech_busy"})
                return
            try:
                self.respond(200, generate(key, text, style, rate))
            except SpeechError as error:
                self.respond(error.status, {"error": error.code})
            except Exception:
                self.respond(502, {"error": "speech_unavailable"})
            finally:
                slots.release()

    return Handler


def main():
    token = os.environ.get("PADI_VOICE_SERVICE_TOKEN", "")
    key = os.environ.get("GEMINI_API_KEY", "")
    groq_key=os.environ.get("GROQ_API_KEY", "")
    confirmed=os.environ.get("PADI_AI_FREE_ACCOUNT_CONFIRMED", "").split(",")
    if len(token) < 32 or not key or not groq_key or "gemini" not in confirmed or "groq" not in confirmed:
        raise SystemExit("Python voice requires an internal token, Gemini/Groq credentials, and confirmed free-tier use.")
    port = int(os.environ.get("PADI_PYTHON_VOICE_PORT", "8090"))
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(token, key,groq_key=groq_key))
    server.daemon_threads = True
    print(f"Python voice service listening on 127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
