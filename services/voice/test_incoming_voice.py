"""Incoming audio, local inference, cancellation and private upload contracts.

Codec tests encode real audio with bundled FFmpeg. The local model test runs
when the explicitly installed checkpoint exists; it never downloads a model.
"""
from array import array
from contextlib import contextmanager
import http.client
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import wave

import av
import numpy as np

import app
import audio_processing
from audio_processing import decode_audio_file, prepare_audio
from local_recognition import RecognitionConfig, RecognitionPool, load_model, recognise_file
from live_recognition import LiveTurn, load_live_model
from install_conversation_models import MODEL_DIR, VOSK_NAME
from voice_errors import SpeechError

ROOT = Path(__file__).resolve().parents[2]
SPEECH = ROOT / "frontend/tests/fixtures/please-continue.wav"
MODEL = Path(os.environ.get("PADI_STT_MODEL_PATH", str(Path(__file__).parent / "models/base")))


def wave_bytes(pcm, rate=16000, channels=1, width=2):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(width)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return output.getvalue()


def encode_recording(path, audio, kind="webm", codec="libopus"):
    """Real codec fixtures, generated from public/synthetic PCM at test time."""
    with wave.open(io.BytesIO(audio), "rb") as wav:
        rate, channels = wav.getframerate(), wav.getnchannels()
        raw = wav.readframes(wav.getnframes())
    with av.open(str(path), "w", format=kind) as output:
        stream = output.add_stream(codec, rate=48000)
        stream.layout = "mono"
        stream.bit_rate = 32000
        stream.codec_context.format = "s16" if codec == "libopus" else "fltp"
        resampler = av.AudioResampler(format=stream.codec_context.format.name, layout="mono", rate=48000)
        frame = av.AudioFrame.from_ndarray(np.frombuffer(raw, dtype="<i2").reshape(1, -1), format="s16", layout="mono" if channels == 1 else "stereo")
        frame.sample_rate = rate
        for converted in [*resampler.resample(frame), *resampler.resample(None)]:
            for packet in stream.encode(converted):
                output.mux(packet)
        for packet in stream.encode(None):
            output.mux(packet)


def controlled_worker(connection, config):
    """A deliberately uninterruptible test job exercises process isolation."""
    connection.send({"ready": True})
    try:
        while True:
            job = connection.recv()
            if job is None:
                return
            if job["mime"] == "block":
                while True:
                    time.sleep(1)
            if job["mime"] == "fail":
                connection.send({"error": "transcription_failed", "status": 502})
            else:
                connection.send({"result": {"text": "unit-test result", "audio_bytes": 10}})
    except (EOFError, BrokenPipeError):
        pass
    finally:
        connection.close()


def missing_model_worker(connection, config):
    connection.send({"ready": False, "error": "model_not_installed"})
    connection.close()


def until(predicate, seconds=5):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.02)
    raise AssertionError("Timed out waiting for bounded voice worker state")


@contextmanager
def private_server(pool=None):
    server = ThreadingHTTPServer(("127.0.0.1", 0), app.make_handler("x" * 32, "", recognition_pool=pool))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)


def upload_body(audio, language="auto", owner="account-a", request_id="a" * 32):
    body = bytearray()
    for name, value in (("request_id", request_id), ("user_id", owner), ("language", language)):
        body.extend(f'--test\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(b'--test\r\nContent-Disposition: form-data; name="file"; filename="../../never-use-this-path.wav"\r\nContent-Type: audio/wav\r\n\r\n')
    body.extend(audio)
    body.extend(b'\r\n--test--\r\n')
    return body


def post(server, path, body, token="x" * 32, media="multipart/form-data; boundary=test"):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
    try:
        connection.request("POST", path, body, {"Authorization": "Bearer " + token, "Content-Type": media})
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


class AudioTests(unittest.TestCase):
    def test_real_opus_decodes_into_16khz_mono_pcm(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.audio"
            encode_recording(path, SPEECH.read_bytes())
            decoded = decode_audio_file(str(path), "audio/webm;codecs=opus")
            self.assertEqual((decoded.codec, decoded.container), ("opus", "webm"))
            self.assertEqual(decoded.pcm_bytes, round(decoded.duration_seconds * 16000) * 2)
            with wave.open(io.BytesIO(decoded.wav)) as wav:
                self.assertEqual((wav.getframerate(), wav.getnchannels(), wav.getsampwidth()), (16000, 1, 2))
            self.assertLess(path.stat().st_size, decoded.pcm_bytes)
            self.assertGreater(len(prepare_audio(decoded.wav)), 44)

    def test_real_aac_fallback_is_identified_and_decoded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fallback.audio"
            encode_recording(path, SPEECH.read_bytes(), "mp4", "aac")
            decoded = decode_audio_file(str(path), "audio/mp4")
            self.assertEqual((decoded.codec, decoded.container), ("aac", "mp4"))
            self.assertEqual(len(prepare_audio(decoded.wav)) % 2, 0)

    def test_empty_corrupted_and_wrong_container_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.audio"
            for value in (b"", b"corrupted audio", b"\x1a\x45\xdf\xa3" + bytes(40)):
                path.write_bytes(value)
                with self.assertRaises(SpeechError):
                    decode_audio_file(str(path), "audio/webm")
            encode_recording(path, SPEECH.read_bytes(), "matroska")
            with self.assertRaises(SpeechError) as caught:
                decode_audio_file(str(path), "audio/webm")
            self.assertEqual(caught.exception.code, "unsupported_audio_format")
            encode_recording(path, SPEECH.read_bytes())
            original = path.read_bytes()
            for corrupted in (original[:80], original[:-1], original[:-7], original[:-1000]):
                path.write_bytes(corrupted)
                with self.assertRaises(SpeechError):
                    decode_audio_file(str(path), "audio/webm")

    def test_unsupported_actual_pcm_codec_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "input.audio"
            path.write_bytes(wave_bytes(bytes(1600 * 4), width=4))
            with self.assertRaises(SpeechError) as caught:
                decode_audio_file(str(path), "audio/wav")
            self.assertEqual(caught.exception.code, "unsupported_audio_codec")

    def test_silent_opus_is_rejected_by_preparation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "silent.audio"
            encode_recording(path, wave_bytes(bytes(32000)))
            decoded = decode_audio_file(str(path), "audio/webm")
            with self.assertRaises(SpeechError) as caught:
                prepare_audio(decoded.wav)
            self.assertEqual(caught.exception.code, "no_speech")

    def test_stereo_44100hz_is_converted_once_to_mono_16000hz(self):
        samples = np.arange(44100)
        pcm = np.column_stack((4000 * np.sin(samples * 2 * np.pi * 440 / 44100), 3000 * np.sin(samples * 2 * np.pi * 880 / 44100))).astype("<i2").tobytes()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stereo.wav"
            path.write_bytes(wave_bytes(pcm, 44100, 2))
            decoded = decode_audio_file(str(path), "audio/wav")
            self.assertEqual(decoded.pcm_bytes, 32000)
            self.assertEqual(decoded.duration_seconds, 1)

    def test_duration_and_size_are_bounded_before_recognition(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "long.audio"
            encode_recording(path, wave_bytes(bytes(61 * 32000)))
            with self.assertRaises(SpeechError) as caught:
                decode_audio_file(str(path), "audio/webm")
            self.assertEqual(caught.exception.code, "audio_too_long")
            path.write_bytes(bytes(audio_processing.MAX_AUDIO_BYTES + 1))
            with self.assertRaises(SpeechError) as caught:
                decode_audio_file(str(path), "audio/webm")
            self.assertEqual(caught.exception.code, "audio_too_large")

    def test_silence_trim_keeps_speech_and_half_second_margins(self):
        with wave.open(str(SPEECH)) as wav:
            source = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
            rate = wav.getframerate()
        # Decode/resample first, then add known silence at the engine rate.
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source.wav"
            path.write_bytes(wave_bytes(source.tobytes(), rate))
            decoded = decode_audio_file(str(path), "audio/wav")
        with wave.open(io.BytesIO(decoded.wav)) as wav:
            raw = wav.readframes(wav.getnframes())
        padded = wave_bytes(bytes(32000) + raw + bytes(32000))
        prepared = prepare_audio(padded)
        self.assertLess(len(prepared), len(padded) - 16000)
        self.assertGreater(len(prepared), len(raw))
        # WebRTC VAD may keep a few speech frames after the waveform ends.
        # The existing trim margins are 500 ms per edge, plus that VAD tail.
        self.assertLessEqual(len(prepared), len(raw) + 32000 + 6400 + 44)


class ShortGreetingTests(unittest.TestCase):
    def test_recorded_hi_and_pronoun_through_the_local_models(self):
        directory = os.environ.get("PADI_LIVE_STT_MODEL_PATH", str(MODEL_DIR / VOSK_NAME))
        live = load_live_model(directory)
        if live is None or not (MODEL / "model.bin").is_file():
            self.skipTest("Install the local Vosk and Whisper checkpoints for the listening regression")
        config = RecognitionConfig(model_path=str(MODEL))
        whisper = load_model(config)
        # Windows retained by the real 50 ms capture detector for these two
        # public fixtures. The browser verification also injects each full file.
        for name, start_ms, duration_ms, expected in [
            ("hi-soft-onset.wav", 850, 1000, "hi"),
            ("spoken-i.wav", 650, 1150, "i"),
        ]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                source = ROOT / "frontend/tests/fixtures" / name
                with wave.open(str(source)) as wav:
                    wav.setpos(start_ms * 16)
                    pcm = wav.readframes(duration_ms * 16)
                turn = LiveTurn(live)
                turn.handle(json.dumps({"type": "start", "turn": 1, "rate": 16000, "check_short_words": True}))
                for i in range(0, len(pcm), 1600):
                    turn.handle(pcm[i:i + 1600])
                final = turn.handle('{"type":"finish","turn":1}')
                clip = Path(folder) / "capture.wav"
                clip.write_bytes(wave_bytes(pcm))
                checked = recognise_file(whisper, config, str(clip), "audio/wav", "en")["text"].strip(" .!?").lower()
                self.assertEqual(checked, expected)
                self.assertEqual(bool(final.get("check_greeting")), final["text"] == "i")
                self.assertEqual(checked if final.get("check_greeting") else final["text"], expected)


class WorkerTests(unittest.TestCase):
    def pool(self, timeout=2, target=controlled_worker):
        pool = RecognitionPool(RecognitionConfig(timeout=timeout), target=target)
        self.addCleanup(pool.close)
        return pool

    def test_capacity_owner_cancellation_and_replacement(self):
        pool = self.pool()
        until(lambda: pool.health()["ready"])
        old_worker = next(iter(pool.workers.values()))[0]
        errors = []
        def blocked():
            try:
                pool.transcribe("unused", "block", "auto", "a" * 32, "account-a")
            except SpeechError as error:
                errors.append(error.code)
        thread = threading.Thread(target=blocked)
        thread.start()
        until(lambda: pool.health()["active_requests"] == 1)
        with self.assertRaises(SpeechError) as caught:
            pool.transcribe("unused", "normal", "auto", "b" * 32, "account-b")
        self.assertEqual(caught.exception.code, "transcription_busy")
        pool.cancel("a" * 32, "account-b")
        self.assertEqual(pool.health()["active_requests"], 1)
        pool.cancel("a" * 32, "account-a")
        thread.join(3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, ["cancelled"])
        self.assertFalse(old_worker.alive(), "abandoned native inference was not terminated")
        until(lambda: pool.health()["ready"])
        result = pool.transcribe("unused", "normal", "auto", "c" * 32, "account-b")
        self.assertEqual(result["user_id"], "account-b")
        self.assertEqual(pool.health()["active_requests"], 0)

    def test_timeout_reaps_worker_and_releases_capacity(self):
        pool = self.pool(timeout=.15)
        until(lambda: pool.health()["ready"])
        old_worker = next(iter(pool.workers.values()))[0]
        with self.assertRaises(SpeechError) as caught:
            pool.transcribe("unused", "block", "auto", "a" * 32, "account-a")
        self.assertEqual(caught.exception.code, "transcription_timeout")
        self.assertFalse(old_worker.alive())
        self.assertEqual(pool.health()["active_requests"], 0)
        until(lambda: pool.health()["ready"])

    def test_disconnect_is_cancelled_and_cleaned_up(self):
        pool = self.pool()
        until(lambda: pool.health()["ready"])
        old_worker = next(iter(pool.workers.values()))[0]
        with self.assertRaises(SpeechError) as caught:
            pool.transcribe("unused", "block", "auto", "a" * 32, "account-a", lambda: True)
        self.assertEqual(caught.exception.code, "cancelled")
        self.assertFalse(old_worker.alive())

    def test_early_cancel_is_scoped_to_owner(self):
        pool = self.pool()
        until(lambda: pool.health()["ready"])
        pool.cancel("a" * 32, "account-a")
        result = pool.transcribe("unused", "normal", "auto", "a" * 32, "account-b")
        self.assertEqual(result["user_id"], "account-b")
        with self.assertRaises(SpeechError) as caught:
            pool.transcribe("unused", "normal", "auto", "a" * 32, "account-a")
        self.assertEqual(caught.exception.code, "cancelled")

    def test_failure_returns_safe_code_and_worker_remains_usable(self):
        pool = self.pool()
        until(lambda: pool.health()["ready"])
        with self.assertRaises(SpeechError) as caught:
            pool.transcribe("unused", "fail", "auto", "a" * 32, "account-a")
        self.assertEqual(caught.exception.code, "transcription_failed")
        self.assertEqual(pool.transcribe("unused", "normal", "auto", "b" * 32, "account-b")["user_id"], "account-b")

    def test_missing_model_has_unready_health_without_download(self):
        pool = self.pool(target=missing_model_worker)
        until(lambda: pool.health()["error"] == "model_not_installed")
        self.assertFalse(pool.health()["ready"])
        with self.assertRaises(SpeechError) as caught:
            pool.transcribe("unused", "normal", "auto", "a" * 32, "account-a")
        self.assertEqual(caught.exception.status, 503)

    def test_shutdown_terminates_active_jobs(self):
        pool = self.pool()
        until(lambda: pool.health()["ready"])
        worker = next(iter(pool.workers.values()))[0]
        errors = []
        def blocked():
            try:
                pool.transcribe("unused", "block", "auto", "a" * 32, "account-a")
            except SpeechError as error:
                errors.append(error.code)
        thread = threading.Thread(target=blocked)
        thread.start()
        until(lambda: pool.health()["active_requests"] == 1)
        pool.close()
        thread.join(3)
        self.assertFalse(worker.alive())
        self.assertEqual(errors, ["cancelled"])
        self.assertFalse(thread.is_alive())


class UploadTests(unittest.TestCase):
    def test_authentication_and_temporary_file_cleanup_on_failure(self):
        paths = []
        class Pool:
            def transcribe(self, path, *_args):
                paths.append(path)
                self_path = Path(path)
                if not self_path.name.startswith("padi-voice-"):
                    raise AssertionError("untrusted upload filename used")
                raise SpeechError(422, "no_speech")
        with private_server(Pool()) as server:
            body = upload_body(SPEECH.read_bytes())
            self.assertEqual(post(server, "/transcribe", body, "bad")[0], 401)
            self.assertEqual(paths, [])
            self.assertEqual(post(server, "/transcribe", body)[0], 422)
        self.assertEqual(len(paths), 1)
        self.assertFalse(Path(paths[0]).exists())

    def test_transcript_is_not_logged_and_files_are_not_retained(self):
        paths = []
        class Pool:
            def transcribe(self, path, mime, language, request_id, user_id, disconnected):
                paths.append(path)
                return {"text": "DO_NOT_LOG_PRIVATE_SPEECH", "audio_bytes": Path(path).stat().st_size, "request_id": request_id, "user_id": user_id}
        with private_server(Pool()) as server, self.assertLogs("padi.voice", level="INFO") as logs:
            status, result = post(server, "/transcribe", upload_body(SPEECH.read_bytes()))
            self.assertEqual(status, 200)
            self.assertEqual(result["user_id"], "account-a")
            self.assertNotIn(result["text"], "\n".join(logs.output))
        self.assertTrue(all(not Path(path).exists() for path in paths))

    def test_cancel_requires_internal_auth_and_valid_owner_identity(self):
        calls = []
        class Pool:
            def cancel(self, request_id, owner):
                calls.append((request_id, owner))
        with private_server(Pool()) as server:
            body = json.dumps({"request_id": "a" * 32, "user_id": "account-a"})
            self.assertEqual(post(server, "/cancel", body, "bad", "application/json")[0], 401)
            self.assertEqual(post(server, "/cancel", body, media="application/json")[0], 202)
            for invalid in ({"request_id": "../path", "user_id": "account-a"}, {"request_id": "a" * 32, "user_id": []}, {"request_id": "a" * 32}):
                self.assertEqual(post(server, "/cancel", json.dumps(invalid), media="application/json")[0], 400)
        self.assertEqual(calls, [("a" * 32, "account-a")])


@unittest.skipUnless((MODEL / "model.bin").is_file(), "Explicitly install the local model before recognition verification")
class LocalEngineTests(unittest.TestCase):
    def test_actual_local_whisper_transcribes_opus_speech_without_network(self):
        config = RecognitionConfig(model_path=str(MODEL))
        with patch("urllib.request.urlopen", side_effect=AssertionError("recognition contacted an external API")):
            model = load_model(config)
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "speech.audio"
                encode_recording(path, SPEECH.read_bytes())
                result = recognise_file(model, config, str(path), "audio/webm", "en")
        self.assertEqual(result["text"].strip().lower().rstrip(".!?"), "please continue")
        self.assertEqual((result["language"], result["codec"], result["sample_rate"]), ("en", "opus", 16000))
        self.assertGreater(result["transcription_ms"], 0)
        self.assertIsNone(model.request_features, "speech features were retained between requests")
        del model


if __name__ == "__main__":
    unittest.main()
