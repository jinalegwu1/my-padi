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

    def test_new_model_receives_only_spoken_words_and_separate_delivery(self):
        for model in app.NATURAL_MODELS:
            for style in app.VOICE_STYLES:
                with self.subTest(model=model,style=style):
                    words="How you dey? Let's take this one step at a time."
                    payload=app.speech_payload(words,style,1,"pcm-NG",model,"voice_test_original")
                    part=payload["contents"][0]["parts"][0]
                    self.assertEqual(part["text"],words)
                    self.assertIn("Pidgin",part["speech_metadata"]["style"])
                    selected=payload["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"]
                    self.assertEqual(selected,"voice_test_original" if style=="baby" else app.VOICE_STYLES[style][0])

    def test_text_model_cannot_be_selected_as_a_working_voice_model(self):
        with self.assertRaises(app.SpeechError):
            app.speech_payload("Hello","baby",1,"en-NG","gemini-3.5-flash","voice_test_original")

    def test_new_provider_wav_is_validated_and_normalised_without_double_header(self):
        pcm=b"\x01\x00"*240
        # A legal extra RIFF chunk must not become part of the spoken PCM.
        original=bytearray(pcm_wav(pcm,24000))
        original[4:8]=(len(original)-8+12).to_bytes(4,"little")
        original=original[:36]+b"JUNK\x04\x00\x00\x00test"+original[36:]
        result=app.decode_audio({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/wav","data":base64.b64encode(original).decode()}}]}}]})
        audio=base64.b64decode(result["audio_base64"])
        self.assertEqual(len(audio),44+len(pcm))
        with wave.open(io.BytesIO(audio)) as wav:
            self.assertEqual(wav.getframerate(),24000)
            self.assertEqual(wav.readframes(wav.getnframes()),pcm)
        for invalid in (pcm_wav(pcm,16000),bytes(original[:-2]),b"RIFFbad"):
            with self.assertRaises(app.SpeechError):
                app.decode_audio({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/wav","data":base64.b64encode(invalid).decode()}}]}}]})

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
        handler=app.make_handler("x"*32,"private-test-key",generate=lambda key,text,style,rate,language: calls.append((text,style,rate,language)) or {"audio_base64":"test","mime_type":"audio/wav"})
        server=ThreadingHTTPServer(("127.0.0.1",0),handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            for body,token,status in [
                ({"text":"Hi","style":"ada","rate":1},"bad",401),
                ({"text":"","style":"ada","rate":1},"x"*32,400),
                ({"text":"Hi","style":"unknown","rate":1},"x"*32,400),
                ({"text":"Hi","style":"ada","rate":1,"language":"ignore the transcript"},"x"*32,400),
                ({"text":"Hi","style":"ada","rate":1,"language":[]},"x"*32,400),
                ({"text":"Hi","style":"ada","rate":1},"x"*32,200),
                ({"text":"How you dey?","style":"tunde","rate":1.15,"language":"pcm-NG"},"x"*32,200),
            ]:
                connection=http.client.HTTPConnection("127.0.0.1",server.server_port)
                connection.request("POST","/synthesise",json.dumps(body),{"Authorization":"Bearer "+token,"Content-Type":"application/json"})
                response=connection.getresponse(); self.assertEqual(response.status,status); self.assertEqual(response.getheader("Cache-Control"),"no-store"); response.read(); connection.close()
            self.assertEqual(calls,[("Hi","ada",1,"en-NG"),("How you dey?","tunde",1.15,"pcm-NG")])
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__=="__main__": unittest.main()
