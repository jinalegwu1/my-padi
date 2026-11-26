import base64
import ctypes.util
import http.client
import io
import json
import threading
import unittest
import wave
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import app
from local_speech import local_engine
from voice_errors import SpeechError


class LocalSpeechTests(unittest.TestCase):
    @unittest.skipUnless(ctypes.util.find_library("espeak-ng"), "eSpeak NG shared library unavailable")
    def test_real_local_engine_generates_complete_canonical_audio_without_network(self):
        with patch.object(app.urllib.request, "urlopen", side_effect=AssertionError("local audio contacted network")):
            result = app.synthesise_local("Hello. This is a complete spoken reply.", "baby", 1, "en-GB")
        with wave.open(io.BytesIO(base64.b64decode(result["audio_base64"]))) as wav:
            self.assertEqual((wav.getframerate(), wav.getnchannels(), wav.getsampwidth()), (24000, 1, 2))
            self.assertGreater(wav.getnframes(), 24000)
            self.assertEqual(len(wav.readframes(wav.getnframes())), wav.getnframes() * 2)
        self.assertEqual(result["input_tokens"], 0)
        self.assertEqual(result["audio_tokens"], 0)

    @unittest.skipUnless(ctypes.util.find_library("espeak-ng"), "eSpeak NG shared library unavailable")
    def test_local_speech_rejects_silent_truncation_and_unsupported_languages(self):
        for text, language in (("hello\0unfinished reply", "en-NG"), ("Hello", "ha-NG")):
            with self.subTest(language=language), self.assertRaises(SpeechError):
                local_engine().speak(text, "ada", 1, language)

    def test_local_http_route_needs_only_internal_token_and_keeps_input_unchanged(self):
        calls=[]
        def generate(text,style,rate,language):
            calls.append((text,style,rate,language))
            output=io.BytesIO()
            with wave.open(output,"wb") as wav:
                wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(24000);wav.writeframes(b"\x01\x00"*240)
            return {"audio_base64":base64.b64encode(output.getvalue()).decode(),"mime_type":"audio/wav","input_tokens":0,"audio_tokens":0}
        server=ThreadingHTTPServer(("127.0.0.1",0),app.make_handler("x"*32,engine="local",local_generate=generate))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            connection=http.client.HTTPConnection("127.0.0.1",server.server_port)
            body=json.dumps({"text":"PADI, I bought a phone.","style":"ada","rate":1,"language":"en-NG"})
            with patch.object(app.urllib.request,"urlopen",side_effect=AssertionError("local route called a cloud speech model")):
                connection.request("POST","/synthesise",body,{"Authorization":"Bearer "+"x"*32,"Content-Type":"application/json"})
                response=connection.getresponse();result=json.loads(response.read())
            self.assertEqual(response.status,200)
            self.assertEqual(calls,[("PADI, I bought a phone.","ada",1,"en-NG")])
            self.assertEqual(result["mime_type"],"audio/wav")
            connection.close()
        finally:
            server.shutdown();server.server_close();thread.join()
