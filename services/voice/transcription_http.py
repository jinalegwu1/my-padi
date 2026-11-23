"""Private Go-to-Python upload boundary; audio exists only for its request."""
from email.parser import BytesParser
from email import policy
from email.message import Message
import os
import re
import select
import socket
import tempfile
import threading
import time

from audio_processing import MAX_AUDIO_BYTES
from voice_errors import SpeechError


def valid_identity(request_id, user_id):
    return bool(re.fullmatch(r"[a-f0-9]{32}", request_id) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", user_id))


def receive_upload(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise SpeechError(400, "invalid_audio") from None
    if not 0 < length <= MAX_AUDIO_BYTES + 4096 or handler.headers.get("Transfer-Encoding"):
        raise SpeechError(413 if length > MAX_AUDIO_BYTES + 4096 else 400, "audio_too_large" if length > MAX_AUDIO_BYTES + 4096 else "invalid_audio")
    mime = Message()
    mime["Content-Type"] = handler.headers.get("Content-Type", "")
    boundary = mime.get_param("boundary", "")
    if mime.get_content_type() != "multipart/form-data" or not re.fullmatch(r"[A-Za-z0-9_-]{1,70}", boundary):
        raise SpeechError(400, "invalid_audio")
    delimiter = b"--" + boundary.encode()
    remaining = length

    def read(size):
        nonlocal remaining
        if size < 0 or size > remaining:
            raise SpeechError(400, "invalid_audio")
        value = handler.rfile.read(size)
        remaining -= len(value)
        if len(value) != size:
            raise SpeechError(400, "invalid_audio")
        return value

    def line():
        nonlocal remaining
        value = handler.rfile.readline(min(2049, remaining + 1))
        remaining -= len(value)
        if len(value) > 2048 or not value.endswith(b"\r\n") or remaining < 0:
            raise SpeechError(400, "invalid_audio")
        return value

    path = None
    try:
        if line() != delimiter + b"\r\n":
            raise SpeechError(400, "invalid_audio")
        fields = {}
        while True:
            headers = bytearray()
            while True:
                item = line()
                if item == b"\r\n":
                    break
                headers.extend(item)
                if len(headers) > 2048:
                    raise SpeechError(400, "invalid_audio")
            part = BytesParser(policy=policy.default).parsebytes(bytes(headers) + b"\r\n")
            if part.get_content_disposition() != "form-data":
                raise SpeechError(400, "invalid_audio")
            name = part.get_param("name", header="content-disposition")
            if name == "file":
                suffix = b"\r\n" + delimiter + b"--\r\n"
                size = remaining - len(suffix)
                if not 0 < size <= MAX_AUDIO_BYTES:
                    raise SpeechError(400, "invalid_audio")
                with tempfile.NamedTemporaryFile(prefix="padi-voice-", suffix=".audio", delete=False) as output:
                    path = output.name
                    trailing = b""
                    left = size
                    while left:
                        chunk = read(min(65536, left))
                        if b"\r\n" + delimiter in trailing + chunk:
                            raise SpeechError(400, "invalid_audio")
                        trailing = chunk[-len(delimiter) - 2:]
                        output.write(chunk)
                        left -= len(chunk)
                if read(len(suffix)) != suffix or remaining != 0:
                    raise SpeechError(400, "invalid_audio")
                request_id, user_id = fields.get("request_id", ""), fields.get("user_id", "")
                if not valid_identity(request_id, user_id):
                    raise SpeechError(400, "invalid_request")
                language = fields.get("language", "auto")
                if not re.fullmatch(r"auto|[a-z]{2,3}", language):
                    raise SpeechError(400, "invalid_language")
                return path, part.get("Content-Type", ""), language, request_id, user_id
            if name not in ("request_id", "user_id", "language") or name in fields or part.get_filename():
                raise SpeechError(400, "invalid_audio")
            value = line()[:-2]
            if len(value) > 512:
                raise SpeechError(400, "invalid_audio")
            fields[name] = value.decode("utf8")
            if line() != delimiter + b"\r\n":
                raise SpeechError(400, "invalid_audio")
    except Exception:
        if path:
            os.unlink(path)
        raise


def process_upload(handler, pool):
    if pool is None:
        raise SpeechError(503, "model_unavailable")
    started = time.monotonic()
    path = None
    try:
        # Socket inactivity timeouts alone do not bound a slow, trickling body.
        # The private Go-to-Python upload gets a fixed ten-second deadline.
        expired = threading.Event()
        def expire():
            expired.set()
            try:
                handler.connection.shutdown(socket.SHUT_RD)
            except OSError:
                pass
        timer = threading.Timer(10, expire)
        timer.daemon = True
        timer.start()
        try:
            path, mime, language, request_id, user_id = receive_upload(handler)
        except SpeechError:
            if expired.is_set():
                raise SpeechError(504, "upload_timeout") from None
            raise
        finally:
            timer.cancel()

        def disconnected():
            try:
                if select.select([handler.connection], [], [], 0)[0]:
                    return handler.connection.recv(1, socket.MSG_PEEK) == b""
            except OSError:
                return True
            return False

        result = pool.transcribe(path, mime, language, request_id, user_id, disconnected)
        result["service_ms"] = round((time.monotonic() - started) * 1000, 2)
        return result
    except (socket.timeout, TimeoutError):
        raise SpeechError(504, "upload_timeout") from None
    except (UnicodeError, ValueError, OSError):
        raise SpeechError(400, "invalid_audio") from None
    finally:
        if path:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
