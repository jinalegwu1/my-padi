"""Verify the configuration boundary without implementing personality engines."""

from dataclasses import FrozenInstanceError
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


if __name__ == "__main__":
    unittest.main()
