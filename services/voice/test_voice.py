import base64
import http.client
import io
import json
import threading
import unittest
import wave
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import app


def pcm_wav(pcm, rate=16000):
    out=io.BytesIO()
    with wave.open(out,"wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(pcm)
    return out.getvalue()


class VoiceTests(unittest.TestCase):
    def test_selected_language_is_carried_into_the_actual_transcription_payload(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read(self, _limit): return b'{"text":"Hello","duration":1}'
        for language in ("en", "fr"):
            with patch.object(app, "prepare_audio", return_value=pcm_wav(b"\x01\x00"*160)), patch.object(app.urllib.request, "urlopen", return_value=Response()) as call:
                self.assertEqual(app.recognise("test-key", b"public-audio", language=language)["text"], "Hello")
            request = call.call_args.args[0]
            self.assertIn(f'name="language"\r\n\r\n{language}\r\n'.encode(), request.data)
            self.assertTrue(request.full_url.endswith("/audio/transcriptions"))

    def test_english_delivery_does_not_invite_unrequested_language_switches(self):
        for model in (*app.NATURAL_MODELS, *app.LEGACY_MODELS):
            with self.subTest(model=model):
                payload = app.speech_payload("Hello, how are you?", "ada", 1, "en-NG", model)
                part = payload["contents"][0]["parts"][0]
                directions = part["speech_metadata"]["style"] if model in app.NATURAL_MODELS else part["text"]
                self.assertIn("Speak in English", directions)
                self.assertIn("Do not translate the transcript", directions)
                self.assertNotIn("Follow any language switches", directions)

    def test_transcription_http_handler_preserves_selected_language(self):
        calls = []
        handler = app.make_handler("x"*32, "test-key", transcribe=lambda key, audio, **kwargs: calls.append(kwargs) or {"text":"Hello"})
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            for language, expected in [(None,"en"),("fr","fr"),("unknown",None)]:
                body = b'--test\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF0000WAVEdata\r\n'
                if language is not None:
                    body += f'--test\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}\r\n'.encode()
                body += b'--test--\r\n'
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                connection.request("POST","/transcribe",body,{"Content-Type":"multipart/form-data; boundary=test","Authorization":"Bearer "+"x"*32})
                response = connection.getresponse(); response.read(); connection.close()
                self.assertEqual(response.status, 200 if expected else 400)
                if expected: self.assertEqual(calls[-1]["language"], expected)
            self.assertEqual(len(calls),2)
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_fast_speech_keeps_the_actual_words_and_normalises_audio(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self,*_args): pass
            def read(self,_limit): return pcm_wav(b"\x01\x00"*160,16000)
        with patch.object(app.urllib.request,"urlopen",return_value=Response()) as call:
            result=app.synthesise_groq("test-key","Hey! How are you?","ada")
        payload=json.loads(call.call_args.args[0].data)
        self.assertEqual(payload["input"],"Hey! How are you?")
        self.assertEqual(payload["voice"],"hannah")
        with wave.open(io.BytesIO(base64.b64decode(result["audio_base64"]))) as wav:
            self.assertEqual(wav.getframerate(),24000)
            self.assertEqual(wav.getnframes(),240)

    def test_fast_provider_terms_requirement_never_becomes_fake_audio(self):
        failure=urllib.error.HTTPError("https://provider.invalid",400,"Terms",{},io.BytesIO(b'{"error":{"code":"model_terms_required"}}'))
        with patch.object(app.urllib.request,"urlopen",side_effect=failure):
            with self.assertRaises(app.SpeechError) as caught:
                app.synthesise_groq("test-key","Hello","ada")
        self.assertEqual(caught.exception.code,"speech_terms_required")
        self.assertEqual(caught.exception.status,400)

    def test_fast_streaming_wav_unknown_lengths_use_completed_pcm_and_skip_metadata(self):
        pcm = b"\x01\x00" * 240
        streaming = bytearray(pcm_wav(pcm, 24000))
        streaming[4:8] = b"\xff" * 4
        streaming[40:44] = b"\xff" * 4
        streaming = streaming[:36] + b"LIST\x04\x00\x00\x00test" + streaming[36:]
        result = app.normalise_speech_wave(bytes(streaming))
        audio = base64.b64decode(result["audio_base64"])
        self.assertEqual(int.from_bytes(audio[4:8], "little"), len(audio) - 8)
        with wave.open(io.BytesIO(audio)) as wav:
            self.assertEqual(wav.getnframes(), 240)
            self.assertEqual(wav.readframes(240), pcm)
        for invalid in [bytes(streaming[:-1]), bytes(streaming[:56]), pcm_wav(pcm, 24000)[:-2]]:
            with self.subTest(length=len(invalid)), self.assertRaises(app.SpeechError):
                app.normalise_speech_wave(invalid)

    def test_provider_quota_reset_is_reported_without_provider_details(self):
        details={"error":{"details":[{"retryDelay":"3600s"}]}}
        failure=urllib.error.HTTPError("https://provider.invalid",429,"Quota",{},io.BytesIO(json.dumps(details).encode()))
        with patch.object(app.urllib.request,"urlopen",side_effect=failure):
            with self.assertRaises(app.SpeechError) as caught:
                app.synthesise("test-key","Hello","ada",1)
        self.assertEqual(caught.exception.status,429)
        self.assertEqual(caught.exception.retry_after_seconds,3600)
        self.assertEqual(str(caught.exception),"speech_rate_limited")

    def test_earlier_fallback_uses_the_persona_without_an_unsupported_original_id(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self,*_args): pass
            def read(self,_limit):
                return json.dumps({"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"audio/l16;rate=24000","data":"AQABAA=="}}]}}]}).encode()
        with patch.object(app,"DEFAULT_VOICE_ID","voice_original"),patch.object(app.urllib.request,"urlopen",return_value=Response()) as request:
            app.synthesise("test-key","Hello","baby",1,model=app.LEGACY_MODEL)
        body=json.loads(request.call_args.args[0].data)
        selected=body["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"]
        self.assertEqual(selected,app.VOICE_STYLES["baby"][0])

    def test_quota_recovery_model_uses_the_same_persona_and_delivery(self):
        payload=app.speech_payload("Hello","ada",1,"en-NG",app.FALLBACK_VOICE_MODEL)
        self.assertEqual(payload["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"],"Sulafat")
        self.assertTrue(payload["contents"][0]["parts"][0]["text"].endswith("Hello"))

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

    def test_speech_preserves_sensitive_and_playful_replies_without_generating_new_words(self):
        replies = [
            "I'm sorry you are carrying so much right now. I can listen.",
            "You did it! That rainy commute finally met its match.",
        ]
        for reply in replies:
            for model in app.NATURAL_MODELS:
                with self.subTest(model=model, reply=reply):
                    part=app.speech_payload(reply,"ada",1,"en-NG",model)["contents"][0]["parts"][0]
                    self.assertEqual(part["text"],reply)
                    self.assertIn("Match the emotional tone of the words.",part["speech_metadata"]["style"])
            legacy=app.speech_payload(reply,"ada",1,"en-NG",app.LEGACY_MODEL)["contents"][0]["parts"][0]["text"]
            self.assertTrue(legacy.endswith("TRANSCRIPT:\n"+reply))

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

    def test_authenticated_speech_endpoint_preserves_exact_reply_in_real_payload_builder(self):
        reply = "I'm sorry you are carrying so much right now. I can listen, Ada."
        token = "x" * 32
        pcm = b"\x01\x00" * 240
        provider_result = {
            "candidates": [{
                "content": {"parts": [{
                    "inlineData": {
                        "mimeType": "audio/wav",
                        "data": base64.b64encode(pcm_wav(pcm, 24000)).decode(),
                    },
                }]},
            }],
            "usageMetadata": {"promptTokenCount": 8, "candidatesTokenCount": 12},
        }
        provider_requests = []

        class ProviderResponse:
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read(self, _limit): return json.dumps(provider_result).encode()

        def call_provider(request, timeout):
            provider_requests.append((request, timeout))
            return ProviderResponse()

        def synthesize(key, text, style, rate, language):
            return app.synthesise(key, text, style, rate, language, model=app.NATURAL_MODEL)

        with patch.object(app, "MODEL", app.NATURAL_MODEL), \
                patch.object(app, "FALLBACK_MODEL", ""), \
                patch.object(app.urllib.request, "urlopen", side_effect=call_provider):
            handler = app.make_handler(token, "provider-key", generate=synthesize)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                connection.request(
                    "POST",
                    "/synthesise",
                    json.dumps({
                        "text": reply,
                        "style": "ada",
                        "rate": 1,
                        "language": "en-NG",
                        "model": app.NATURAL_MODEL,
                    }),
                    {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                )
                response = connection.getresponse()
                response_body = json.loads(response.read())
                connection.close()

            finally:
                server.shutdown()
                server.server_close()
                thread.join()

        self.assertEqual(response.status, 200)
        self.assertEqual(len(provider_requests), 1)
        self.assertEqual(provider_requests[0][1], 45)
        payload = json.loads(provider_requests[0][0].data)
        part = payload["contents"][0]["parts"][0]
        self.assertEqual(part["text"], reply)
        self.assertIn("Match the emotional tone of the words.", part["speech_metadata"]["style"])
        self.assertEqual(response_body["mime_type"], "audio/wav")


if __name__=="__main__": unittest.main()
