"""Verify the configuration boundary without implementing personality engines."""

from dataclasses import FrozenInstanceError
import json
from pathlib import Path
import subprocess
import sys
import unittest

from padi_personality import core
from padi_personality.conversation.response_style import build_warmth_guidance
from padi_personality.conversation.understanding import UNDERSTANDING_GUIDANCE
from padi_personality.emotions.emotion_recognition import EMOTION_RECOGNITION_GUIDANCE
from padi_personality.emotions.emotional_responses import EMOTIONAL_RESPONSE_GUIDANCE
from padi_personality.humour.jokes import JOKE_GUIDANCE
from padi_personality.humour.playful_teasing import PLAYFUL_TEASING_GUIDANCE
from padi_personality.humour.storytelling import HUMOROUS_STORYTELLING_GUIDANCE
from padi_personality.personalities.comedian import COMEDIAN_GUIDANCE
from padi_personality.personalities.intellectual import INTELLECTUAL_GUIDANCE
from padi_personality.personality_config import PADI_PERSONALITY_CONFIG


class PersonalityConfigTests(unittest.TestCase):
    def test_all_six_core_traits_are_enabled(self):
        self.assertEqual(
            PADI_PERSONALITY_CONFIG.to_dict(),
            {
                "warm": True,
                "funny": True,
                "witty": True,
                "intelligent": True,
                "playful": True,
                "emotionally_aware": True,
            },
        )

    def test_python_core_uses_the_shared_configuration(self):
        self.assertIs(core.PADI_PERSONALITY_CONFIG, PADI_PERSONALITY_CONFIG)

    def test_configuration_and_export_do_not_share_mutable_state(self):
        exported = PADI_PERSONALITY_CONFIG.to_dict()
        exported["warm"] = False
        self.assertTrue(PADI_PERSONALITY_CONFIG.warm)
        with self.assertRaises(FrozenInstanceError):
            PADI_PERSONALITY_CONFIG.warm = False

    def test_configuration_exports_json_in_an_isolated_python_process(self):
        result = subprocess.run(
            [
                sys.executable,
                "-I",
                "-B",
                str(Path(__file__).with_name("personality_config.py")),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout), PADI_PERSONALITY_CONFIG.to_dict())

    def test_personality_export_contains_all_enabled_guidance(self):
        exported = core.export_personality()

        self.assertEqual(set(exported), {"traits", "warmth_guidance"})
        expected = "\n\n".join(
            section.strip()
            for section in (
                UNDERSTANDING_GUIDANCE,
                build_warmth_guidance(PADI_PERSONALITY_CONFIG),
                EMOTION_RECOGNITION_GUIDANCE,
                EMOTIONAL_RESPONSE_GUIDANCE,
                COMEDIAN_GUIDANCE,
                JOKE_GUIDANCE,
                HUMOROUS_STORYTELLING_GUIDANCE,
                PLAYFUL_TEASING_GUIDANCE,
                INTELLECTUAL_GUIDANCE,
            )
        )
        self.assertEqual(exported["warmth_guidance"], expected)

    def test_personality_export_contains_all_six_traits(self):
        exported = core.export_personality()

        self.assertEqual(
            exported["traits"],
            PADI_PERSONALITY_CONFIG.to_dict(),
        )

    def test_warmth_guidance_is_exported(self):
        exported = core.export_personality()

        self.assertTrue(exported["warmth_guidance"].strip())


if __name__ == "__main__":
    unittest.main()
