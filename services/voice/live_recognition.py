"""Incremental recognition on the private speech service's existing HTTP port."""
import json
from pathlib import Path
import socket

from install_conversation_models import MODEL_DIR, VOSK_NAME


def load_live_model(directory=None):
    from vosk import Model, SetLogLevel
    path = Path(directory) if directory else MODEL_DIR / VOSK_NAME
    if not (path / "am" / "final.mdl").is_file():
        return None
    SetLogLevel(-1)
    return Model(str(path))


class LiveTurn:
    def __init__(self, model):
        from vosk import KaldiRecognizer
        self.model, self.factory = model, KaldiRecognizer
        self.rate = 16000
        self.recognizer = KaldiRecognizer(model, self.rate)
        self.turn = 0
        self.active = False
        self.parts = []
        self.previous = ""
        self.audio_bytes = 0
        self.partial_at = 0
        self.check_short_words = False

    def handle(self, message):
        if isinstance(message, str):
            command = json.loads(message)
            number = command.get("turn")
            if type(number) is not int or not 0 < number <= 2**31 - 1:
                raise ValueError("Invalid turn")
            if command.get("type") == "start" and not self.active and number > self.turn:
                rate = command.get("rate")
                if type(rate) is not int or rate not in (16000, 44100, 48000):
                    raise ValueError("Unsupported sample rate")
                if rate != self.rate:
                    self.recognizer = self.factory(self.model, rate)
                    self.rate = rate
                else:
                    self.recognizer.Reset()
                self.turn, self.active, self.audio_bytes = number, True, 0
                self.partial_at = 0
                self.check_short_words = command.get("check_short_words") is True
                self.parts, self.previous = [], ""
                return {"type": "ack"}
            if command.get("type") != "finish" or not self.active or number != self.turn:
                raise ValueError("Unexpected turn command")
            self.active = False
            tail = json.loads(self.recognizer.FinalResult())["text"]
            final = {"type": "final", "turn": self.turn, "text": self.transcript(tail)}
            # A weak initial h can leave only "i" in Vosk's alternatives.
            # The client already retains short turns for an independent check.
            if self.check_short_words and final["text"] == "i" and 0 < self.audio_bytes <= 2.5 * self.rate * 2:
                final["check_greeting"] = True
            return final
        if not self.active or not 0 < len(message) <= 32000 or len(message) % 2:
            raise ValueError("Invalid live audio")
        self.audio_bytes += len(message)
        if self.audio_bytes > 60 * self.rate * 2:
            raise ValueError("Turn too long")
        if self.recognizer.AcceptWaveform(message):
            self.parts.append(json.loads(self.recognizer.Result())["text"])
            text = self.transcript("")
        else:
            # Kaldi advances in acoustic chunks. Rebuilding a partial lattice
            # on every 50 ms microphone callback competes with decoding.
            if self.audio_bytes - self.partial_at < self.rate * 2 * .12:
                return {"type": "ack"}
            self.partial_at = self.audio_bytes
            text = self.transcript(json.loads(self.recognizer.PartialResult())["partial"])
        if text == self.previous:
            return {"type": "ack"}
        self.previous = text
        return {"type": "partial", "turn": self.turn, "text": text}

    def transcript(self, tail):
        return " ".join(part for part in [*self.parts, tail] if part).strip()


def serve_live(handler, model):
    from simple_websocket import Server, ConnectionClosed
    environ = {"werkzeug.socket": handler.connection}
    environ.update({"HTTP_" + key.upper().replace("-", "_"): value for key, value in handler.headers.items()})
    handler.close_connection = True
    handler.connection.settimeout(None)
    handler.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    ws = Server.accept(environ, max_message_size=32000)
    try:
        turn = LiveTurn(model)
        while True:
            ws.send(json.dumps(turn.handle(ws.receive())))
    except ConnectionClosed:
        pass
    except (TypeError, ValueError, KeyError, AttributeError):
        ws.close(reason=1008, message="Invalid live speech message")
    finally:
        if ws.connected:
            ws.close()
