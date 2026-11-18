import base64
import http.client
import io
import json
import threading
import unittest
import wave
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import app


def pcm_wav(pcm, rate=16000):
    out=io.BytesIO()
    with wave.open(out,"wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(pcm)
    return out.getvalue()


class VoiceTests(unittest.TestCase):
    def test_expression_separate_from_spoken_words(self):
        payload=app.speech_payload("Hello, how are you?","ada",1)
        self.assertEqual(payload["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"],"Sulafat")
        self.assertIn("normal pitch",payload["contents"][0]["parts"][0]["text"])
        self.assertTrue(payload["contents"][0]["parts"][0]["text"].endswith("Hello, how are you?"))

    def test_real_provider_pcm_mime_variants_become_playable_wav(self):
        for mime in ["audio/l16; rate=24000; channels=1","audio/L16;codec=pcm;rate=24000"]:
            result=app.decode_audio({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":mime,"data":base64.b64encode(b"\x01\x00"*240).decode()}}]}}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":30}})
            with wave.open(io.BytesIO(base64.b64decode(result["audio_base64"]))) as wav:
                self.assertEqual(wav.getframerate(),24000); self.assertEqual(wav.getnchannels(),1); self.assertEqual(wav.getnframes(),240)
            self.assertEqual(result["input_tokens"],12)

    def test_invalid_speech_audio_never_appears_playable(self):
        for inline in [{"mimeType":"audio/l16;rate=48000","data":"AAAA"},{"mimeType":"audio/l16;rate=24000","data":"bad!"},{"mimeType":"audio/l16;rate=24000","data":""}]:
            with self.assertRaises(app.SpeechError):
                app.decode_audio({"candidates":[{"content":{"parts":[{"inlineData":inline}]}}]})

    def test_python_vad_rejects_digital_silence(self):
        with self.assertRaises(app.SpeechError) as error:
            app.prepare_audio(pcm_wav(bytes(32000)))
        self.assertEqual(error.exception.code,"no_speech")

    def test_python_noise_filter_and_audio_conversion_preserve_format(self):
        detector=type("Detector",(),{"is_speech":lambda self,data,rate:True})()
        with patch.object(app.webrtcvad,"Vad",return_value=detector):
            result=app.prepare_audio(pcm_wav(b"\x20\x04"*4410,44100))
        with wave.open(io.BytesIO(result)) as wav:
            self.assertEqual(wav.getframerate(),16000); self.assertEqual(wav.getsampwidth(),2); self.assertEqual(wav.getnframes(),1600)

    def test_http_authentication_and_input_validation(self):
        calls=[]
        handler=app.make_handler("x"*32,"private-test-key",generate=lambda key,text,style,rate: calls.append((text,style,rate)) or {"audio_base64":"test","mime_type":"audio/wav"})
        server=ThreadingHTTPServer(("127.0.0.1",0),handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            for body,token,status in [({"text":"Hi","style":"ada","rate":1},"bad",401),({"text":"","style":"ada","rate":1},"x"*32,400),({"text":"Hi","style":"unknown","rate":1},"x"*32,400),({"text":"Hi","style":"ada","rate":1},"x"*32,200)]:
                connection=http.client.HTTPConnection("127.0.0.1",server.server_port)
                connection.request("POST","/synthesise",json.dumps(body),{"Authorization":"Bearer "+token,"Content-Type":"application/json"})
                response=connection.getresponse(); self.assertEqual(response.status,status); self.assertEqual(response.getheader("Cache-Control"),"no-store"); response.read(); connection.close()
            self.assertEqual(calls,[("Hi","ada",1)])
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__=="__main__": unittest.main()
