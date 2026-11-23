"""Persistent, killable local Whisper workers. No external recognition API."""
from dataclasses import dataclass, field
import io
import multiprocessing
import os
from pathlib import Path
import queue
import threading
import time
import wave

from audio_processing import decode_audio_file, prepare_audio
from voice_errors import SpeechError


@dataclass(frozen=True)
class RecognitionConfig:
    model: str = "base"
    model_path: str = ""
    workers: int = 1
    threads: int = 2
    timeout: float = 120

    @classmethod
    def environment(cls):
        model = os.getenv("PADI_STT_MODEL", "base")
        if model not in ("tiny", "base", "small"):
            raise ValueError("PADI_STT_MODEL must be tiny, base or small")
        path = os.getenv("PADI_STT_MODEL_PATH", str(Path(__file__).parent / "models" / model))
        config = cls(model, path, int(os.getenv("PADI_STT_WORKERS", "1")), int(os.getenv("PADI_STT_THREADS", str(min(2, os.cpu_count() or 1)))), float(os.getenv("PADI_STT_TIMEOUT_SECONDS", "120")))
        if not 1 <= config.workers <= 4 or not 1 <= config.threads <= 16 or not 1 <= config.timeout <= 120:
            raise ValueError("Invalid local speech worker configuration")
        return config


@dataclass
class Worker:
    process: object
    connection: object
    cleanup_lock: object = field(default_factory=threading.Lock)

    def alive(self):
        return self.process.is_alive()


def load_model(config):
    from faster_whisper import WhisperModel
    path = Path(config.model_path)
    if not all((path / name).is_file() for name in ("model.bin", "config.json", "tokenizer.json")):
        raise SpeechError(503, "model_not_installed")
    class RequestWhisperModel(WhisperModel):
        # faster-whisper 1.2.1 encodes the first window for language detection
        # and again for transcription. Reuse only identical features within
        # this one request; clear speech features on completion or failure.
        def clear_request_cache(self):
            self.request_features = None
            self.request_encoded = None

        def encode(self, features):
            import numpy as np
            previous = getattr(self, "request_features", None)
            if previous is not None and np.array_equal(previous, features):
                return self.request_encoded
            encoded = super().encode(features)
            self.request_features = features.copy()
            self.request_encoded = encoded
            return encoded

    return RequestWhisperModel(str(path), device="cpu", compute_type="int8", cpu_threads=config.threads, num_workers=1, local_files_only=True)


def _recognise_file(model, config, path, mime, language):
    import numpy as np
    started = time.monotonic()
    decoded = decode_audio_file(path, mime)
    decoded_at = time.monotonic()
    prepared = prepare_audio(decoded.wav)
    prepared_at = time.monotonic()
    with wave.open(io.BytesIO(prepared), "rb") as wav:
        audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768
    selected = None if language in ("", "auto", "ig") else "en" if language == "pcm" else language
    # Preserve the existing fixed Pidgin/Igbo recognition hints. These guide
    # recognition only; recognised words are never corrected afterwards.
    prompt = {"pcm": "How you dey? Na me be PADI. Make we gist.", "ig": "Ndewo. Kedu ka ị mere taa?"}.get(language)
    if selected and selected not in model.supported_languages:
        raise SpeechError(422, "unsupported_language")
    segments, info = model.transcribe(audio, language=selected, task="transcribe", beam_size=3, temperature=0.0,
        condition_on_previous_text=False, vad_filter=False, no_speech_threshold=0.6, initial_prompt=prompt)
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
    if not text:
        raise SpeechError(422, "no_speech")
    if len(text.encode()) > 8192:
        raise SpeechError(502, "invalid_transcription")
    ended = time.monotonic()
    return {"text": text, "language": info.language, "language_probability": float(info.language_probability), "language_detected": selected is None,
        "model": config.model, "duration_seconds": decoded.duration_seconds,
        "audio_bytes": Path(path).stat().st_size, "decoded_pcm_bytes": decoded.pcm_bytes,
        "codec": decoded.codec, "container": decoded.container, "sample_rate": 16000, "channels": 1,
        "decode_ms": round((decoded_at - started) * 1000, 2),
        "prepare_ms": round((prepared_at - decoded_at) * 1000, 2),
        "transcription_ms": round((ended - prepared_at) * 1000, 2),
        "processing_ms": round((ended - started) * 1000, 2)}


def recognise_file(model, config, path, mime, language):
    clear = getattr(model, "clear_request_cache", lambda: None)
    clear()
    try:
        return _recognise_file(model, config, path, mime, language)
    finally:
        clear()


def worker_main(connection, config, loader=load_model):
    # Inference never contacts a model registry, including tokenizer fallback.
    os.environ["HF_HUB_OFFLINE"] = "1"
    for name in tuple(os.environ):
        if name.endswith("_API_KEY") or name in ("PADI_VOICE_SERVICE_TOKEN", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
            os.environ.pop(name, None)
    try:
        model = loader(config)
        connection.send({"ready": True})
    except Exception as error:
        connection.send({"ready": False, "error": error.code if isinstance(error, SpeechError) else "model_load_failed"})
        connection.close()
        return
    try:
        while True:
            job = connection.recv()
            if job is None:
                return
            try:
                result = recognise_file(model, config, job["path"], job["mime"], job["language"])
                connection.send({"result": result})
            except SpeechError as error:
                connection.send({"error": error.code, "status": error.status})
            except Exception:
                connection.send({"error": "transcription_failed", "status": 502})
    except (EOFError, BrokenPipeError):
        pass
    finally:
        connection.close()


class RecognitionPool:
    def __init__(self, config, target=worker_main):
        self.config, self.target = config, target
        self.context = multiprocessing.get_context("spawn")
        self.available = queue.Queue(maxsize=config.workers)
        self.lock = threading.Lock()
        self.workers, self.jobs, self.cancelled = {}, {}, {}
        self.closed, self.error = False, "model_loading"
        for index in range(config.workers):
            self._start(index)

    def _start(self, index):
        with self.lock:
            if self.closed:
                return
            parent, child = self.context.Pipe()
            process = self.context.Process(target=self.target, args=(child, self.config), daemon=True)
            process.start()
            child.close()
            worker = Worker(process, parent)
            self.workers[index] = (worker, False)
            if not any(loaded for _, loaded in self.workers.values()):
                self.error = "model_loading"
        threading.Thread(target=self._await_ready, args=(index, worker), daemon=True).start()

    def _await_ready(self, index, worker):
        connection = worker.connection
        try:
            if not connection.poll(60):
                raise RuntimeError("model load timeout")
            result = connection.recv()
            if not result.get("ready"):
                with self.lock:
                    if self.workers.get(index, (None,))[0] is worker:
                        self.error = result.get("error", "model_load_failed")
                        self.workers.pop(index, None)
                self._kill(worker)
                return
            with self.lock:
                if self.closed or self.workers.get(index, (None,))[0] is not worker:
                    return
                self.workers[index] = (worker, True)
                self.error = ""
                self.available.put_nowait((index, worker))
        except (EOFError, OSError, RuntimeError):
            with self.lock:
                if self.workers.get(index, (None,))[0] is worker:
                    self.error = "model_load_failed"
                    self.workers.pop(index, None)
            self._kill(worker)

    def health(self):
        with self.lock:
            ready = sum(loaded and worker.alive() for worker, loaded in self.workers.values())
            return {"ready": ready > 0, "model": self.config.model, "device": "cpu", "compute_type": "int8",
                "workers": self.config.workers, "ready_workers": ready, "active_requests": len(self.jobs),
                "error": self.error if not ready else "", "timeout_seconds": self.config.timeout}

    def cancel(self, request_id, user_id):
        with self.lock:
            now = time.monotonic()
            self.cancelled = {key: value for key, value in self.cancelled.items() if value > now}
            identity = (request_id, user_id)
            job = self.jobs.get(identity)
            if job:
                job.set()
            elif not job and len(self.cancelled) < 1024:
                self.cancelled[identity] = now + 120

    @staticmethod
    def _kill(worker):
        # Native inference is not safely interruptible inside a Python thread.
        # Reap its isolated process before admitting replacement work.
        with worker.cleanup_lock:
            process = worker.process
            if process.is_alive():
                process.terminate()
            process.join(0.5)
            if process.is_alive():
                process.kill()
                process.join(0.5)
            worker.connection.close()
            return not process.is_alive()

    def transcribe(self, path, mime, language, request_id, user_id, disconnected=lambda: False):
        cancel = threading.Event()
        identity = (request_id, user_id)
        with self.lock:
            if identity in self.jobs:
                raise SpeechError(409, "duplicate_request")
            previous = self.cancelled.pop(identity, None)
            if previous and previous > time.monotonic():
                raise SpeechError(499, "cancelled")
            if self.closed:
                raise SpeechError(503, "model_unavailable")
            try:
                index, worker = self.available.get_nowait()
            except queue.Empty:
                ready = any(loaded and worker.alive() for worker, loaded in self.workers.values())
                raise SpeechError(429 if ready else 503, "transcription_busy" if ready else self.error or "model_unavailable")
            self.jobs[identity] = cancel
        process, connection = worker.process, worker.connection
        recycle = False
        try:
            connection.send({"path": path, "mime": mime, "language": language})
            deadline = time.monotonic() + self.config.timeout
            while True:
                if cancel.is_set() or disconnected():
                    recycle = True
                    raise SpeechError(499, "cancelled")
                if time.monotonic() >= deadline:
                    recycle = True
                    raise SpeechError(504, "transcription_timeout")
                if connection.poll(0.05):
                    response = connection.recv()
                    if "error" in response:
                        raise SpeechError(response.get("status", 502), response["error"])
                    return {**response["result"], "request_id": request_id, "user_id": user_id}
                if not process.is_alive():
                    recycle = True
                    raise SpeechError(502, "transcription_failed")
        except (EOFError, BrokenPipeError, OSError):
            recycle = True
            if cancel.is_set() or disconnected():
                raise SpeechError(499, "cancelled") from None
            raise SpeechError(502, "transcription_failed") from None
        finally:
            with self.lock:
                self.jobs.pop(identity, None)
                closed = self.closed
                recycle = recycle or not worker.alive()
                if recycle:
                    self.workers.pop(index, None)
                elif not closed:
                    self.available.put_nowait((index, worker))
            if recycle:
                killed = self._kill(worker)
                if not closed and killed:
                    self._start(index)
                elif not killed:
                    with self.lock:
                        self.workers[index] = (worker, False)
                        self.error = "worker_cleanup_failed"

    def close(self):
        with self.lock:
            self.closed = True
            workers = [worker for worker, _ in self.workers.values()]
            self.workers.clear()
            while not self.available.empty():
                self.available.get_nowait()
            for cancel in self.jobs.values():
                cancel.set()
        for worker in workers:
            self._kill(worker)
