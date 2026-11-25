"""Local speech audio through eSpeak NG; no model downloads or remote calls."""

import ctypes
import ctypes.util
import io
import threading
import time
import wave

from voice_errors import SpeechError

LANGUAGES = {
    "en-NG": "en", "en-GB": "en", "pcm-NG": "en",
    "fr-FR": "fr", "pt-BR": "pt", "es-ES": "es", "ar-SA": "ar",
    "sw-KE": "sw", "am-ET": "am", "hi-IN": "hi", "zh-CN": "cmn",
}
VOICE_VARIANTS = {
    "baby": "m3", "ada": "f2", "chidi": "m2", "zainab": "f3",
    "tunde": "m1", "amara": "f1", "daniel": "m2",
}
MAX_PCM_BYTES = 8 * 1024 * 1024 - 44
_CALLBACK = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)


class LocalSpeechEngine:
    def __init__(self):
        library = ctypes.util.find_library("espeak-ng")
        if not library:
            raise SpeechError(503, "local_speech_engine_unavailable")
        self.library = ctypes.CDLL(library)
        self.lock = threading.Lock()
        self.library.espeak_Initialize.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
        self.library.espeak_Initialize.restype = ctypes.c_int
        # Synchronous callback output; never open an audio device on the server.
        self.sample_rate = self.library.espeak_Initialize(2, 0, None, 0)
        if not 8000 <= self.sample_rate <= 96000:
            raise SpeechError(503, "local_speech_engine_unavailable")
        self.library.espeak_SetSynthCallback.argtypes = [_CALLBACK]
        self.library.espeak_SetSynthCallback.restype = None
        self.library.espeak_SetVoiceByName.argtypes = [ctypes.c_char_p]
        self.library.espeak_SetVoiceByName.restype = ctypes.c_int
        self.library.espeak_SetParameter.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
        self.library.espeak_SetParameter.restype = ctypes.c_int
        self.library.espeak_Synth.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_uint, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_uint), ctypes.c_void_p]
        self.library.espeak_Synth.restype = ctypes.c_int
        self.library.espeak_Synchronize.restype = ctypes.c_int
        self.chunks = []
        self.total = 0
        self.failure = None
        self.deadline = 0
        self.callback = _CALLBACK(self._audio)
        self.library.espeak_SetSynthCallback(self.callback)

    def _audio(self, samples, count, _events):
        if time.monotonic() > self.deadline:
            self.failure = SpeechError(504, "speech_timeout")
            return 1
        if count <= 0 or not samples:
            return 0
        size = count * 2
        if self.total + size > MAX_PCM_BYTES:
            self.failure = SpeechError(502, "invalid_speech_audio")
            return 1
        self.chunks.append(ctypes.string_at(samples, size))
        self.total += size
        return 0

    def speak(self, text, style, rate, language):
        if language not in LANGUAGES:
            raise SpeechError(422, "unsupported_speech_language")
        if style not in VOICE_VARIANTS or type(rate) not in (int, float) or not 0.5 <= rate <= 1.5:
            raise SpeechError(400, "invalid_speech_configuration")
        if not isinstance(text, str) or not text.strip() or "\0" in text or len(text.encode("utf8")) > 8192:
            raise SpeechError(400, "invalid_speech_configuration")
        with self.lock:
            self.chunks = []
            self.total = 0
            self.failure = None
            self.deadline = time.monotonic() + 30
            try:
                voice = (LANGUAGES[language] + "+" + VOICE_VARIANTS[style]).encode("ascii")
                if self.library.espeak_SetVoiceByName(voice) != 0:
                    raise SpeechError(422, "unsupported_speech_language")
                if self.library.espeak_SetParameter(1, round(175 * rate), 0) != 0:
                    raise SpeechError(400, "invalid_speech_configuration")
                encoded = text.encode("utf8") + b"\0"
                buffer = ctypes.create_string_buffer(encoded)
                # UTF-8 plus an ending pause. SSML is disabled: input is literal text.
                result = self.library.espeak_Synth(buffer, len(encoded), 0, 1, 0, 0x1001, None, None)
                self.library.espeak_Synchronize()
                if self.failure:
                    raise self.failure
                if result != 0 or not self.chunks:
                    raise SpeechError(502, "empty_speech")
                output = io.BytesIO()
                with wave.open(output, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(self.sample_rate)
                    wav.writeframes(b"".join(self.chunks))
                return output.getvalue()
            finally:
                self.chunks = []
                self.total = 0
                self.failure = None


_engine = None
_engine_lock = threading.Lock()


def local_engine():
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = LocalSpeechEngine()
        return _engine
