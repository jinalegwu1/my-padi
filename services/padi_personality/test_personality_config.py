"""Verify the configuration boundary without implementing personality engines."""

from dataclasses import FrozenInstanceError, replace
import json
from pathlib import Path
import subprocess
import sys
import unittest

from padi_personality import core
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

    def test_compact_check_in_and_banter_guidance(self):
        guidance = core.export_personality()["warmth_guidance"]
        self.assertLess(len(guidance.split()), 240)
        for phrase in ("welcome them warmly", "give them a turn", "rival corner",
                       "Retire used premises", "put the jokes down", "gist_seed"):
            self.assertIn(phrase, guidance)

    def test_disabled_traits_are_respected(self):
        for trait, phrase in (("funny", "gist_seed"), ("witty", "comeback"),
                              ("playful", "rival corner"), ("intelligent", "straight answers"),
                              ("emotionally_aware", "put the jokes down")):
            config = replace(PADI_PERSONALITY_CONFIG, **{trait: False})
            self.assertNotIn(phrase, core.export_personality(config)["warmth_guidance"])
        self.assertEqual(core.export_personality(replace(PADI_PERSONALITY_CONFIG, warm=False))
                         ["warmth_guidance"], "")

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
