import unittest

from nigerian_speech import FEMALE_STYLES, PADI_STYLE, padi_phrases


class SignatureDeliveryTests(unittest.TestCase):
    def test_punctuation_survives_as_timing_and_never_adds_spoken_words(self):
        source = "Chinedu, I’m here—take your time. How was Abuja?"
        phrases = list(padi_phrases(source))
        self.assertEqual([p[0] for p in phrases], ["Chinedu, I'm here", "take your time", "How was Abuja"])
        self.assertGreater(phrases[1][1], phrases[0][1])
        self.assertIn(PADI_STYLE, FEMALE_STYLES)

    def test_long_thoughts_and_abbreviations_remain_intact(self):
        text = "Dr. Ada " + "can hear you " * 55 + "in Enugú"
        phrases = list(padi_phrases(text))
        self.assertEqual(" ".join(p[0] for p in phrases), text.replace("ú", "u"))
        self.assertTrue(all(len(p[0]) <= 220 for p in phrases))
        self.assertTrue(all(pause == 0 for _, pause, _ in phrases))
