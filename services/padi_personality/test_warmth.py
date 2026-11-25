"""Verify the Python-owned warmth composition and backend export contract."""

from dataclasses import replace
import json
from pathlib import Path
import subprocess
import sys
import unittest

from padi_personality import core
from padi_personality.conversation.response_style import build_warmth_guidance
from padi_personality.personalities.best_friend import WARMTH_GUIDANCE
from padi_personality.personalities.emotional_intelligence import WARMTH_SUPPORT_GUIDANCE
from padi_personality.personality_config import PADI_PERSONALITY_CONFIG


class WarmthTests(unittest.TestCase):
    def test_guidance_calibrates_greetings_and_casual_sharing(self):
        guidance = core.export_personality()["warmth_guidance"]
        for rule in (
            "For ordinary greetings, respond with a friendly greeting.",
            "Do not\nassume the user is sad or has a problem.",
            "Show interest in what the user shares.",
            "Do not give unsolicited advice unless there is a clear\npractical or safety reason.",
            "A greeting like \"hi\" or \"good morning\" does not mean the user\nis sad or needs emotional support.",
            "Respond with normal interest. Do not turn simple conversation\ninto counselling or emotional support.",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, guidance)

    def test_warmth_distinguishes_moods_and_preserves_conversation_context(self):
        guidance = build_warmth_guidance(PADI_PERSONALITY_CONFIG)
        for rule in (
            "When the user shares good news, celebrate with them.",
            "Keep things light during ordinary conversations.",
            "When the user shares painful news, respond with care.",
            "Pay attention to the current message and available conversation\nhistory.",
            "Do not turn every reply into advice.",
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule, guidance)

    def test_enabled_warmth_composes_both_owners_once(self):
        guidance = build_warmth_guidance(PADI_PERSONALITY_CONFIG)
        self.assertTrue(guidance.startswith(WARMTH_GUIDANCE + "\n\n"))
        self.assertEqual(guidance.count(WARMTH_GUIDANCE), 1)
        self.assertEqual(guidance.count(WARMTH_SUPPORT_GUIDANCE), 1)
        self.assertTrue(guidance.strip())

    def test_disabled_warmth_exports_an_empty_string(self):
        config = replace(PADI_PERSONALITY_CONFIG, warm=False)
        self.assertEqual(build_warmth_guidance(config), "")
        self.assertEqual(core.export_personality(config)["warmth_guidance"], "")

    def test_export_keeps_the_six_trait_configuration(self):
        for enabled in (True, False):
            with self.subTest(warm=enabled):
                config = replace(PADI_PERSONALITY_CONFIG, warm=enabled)
                exported = core.export_personality(config)
                self.assertEqual(set(exported), {"traits", "warmth_guidance"})
                self.assertEqual(exported["traits"], config.to_dict())
                if enabled:
                    self.assertIn(build_warmth_guidance(config).strip(), exported["warmth_guidance"])
                else:
                    self.assertEqual(exported["warmth_guidance"], "")
                self.assertEqual(json.loads(json.dumps(exported)), exported)

    def test_other_traits_do_not_gate_warmth_or_its_support(self):
        config = replace(
            PADI_PERSONALITY_CONFIG,
            funny=False,
            witty=False,
            intelligent=False,
            playful=False,
            emotionally_aware=False,
        )
        self.assertEqual(
            build_warmth_guidance(config), build_warmth_guidance(PADI_PERSONALITY_CONFIG)
        )
        self.assertEqual(core.export_personality(config)["traits"], config.to_dict())

    def test_export_does_not_mutate_or_share_configuration(self):
        exported = core.export_personality()
        original_guidance = exported["warmth_guidance"]
        exported["traits"]["warm"] = False
        exported["warmth_guidance"] = "Changed by caller."
        self.assertTrue(PADI_PERSONALITY_CONFIG.warm)
        self.assertEqual(core.export_personality()["traits"], PADI_PERSONALITY_CONFIG.to_dict())
        self.assertEqual(
            core.export_personality()["warmth_guidance"],
            original_guidance,
        )

    def test_export_works_in_the_isolated_backend_import_path(self):
        root = str(Path(__file__).resolve().parent.parent)
        for enabled in (True, False):
            with self.subTest(warm=enabled):
                result = subprocess.run(
                    [
                        sys.executable, "-I", "-B", "-c",
                        "import json, sys; from dataclasses import replace; "
                        "sys.path.insert(0, sys.argv[1]); "
                        "from padi_personality.core import export_personality, PADI_PERSONALITY_CONFIG; "
                        "print(json.dumps(export_personality(replace(PADI_PERSONALITY_CONFIG, "
                        "warm=sys.argv[2] == 'True'))))",
                        root, str(enabled),
                    ],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                self.assertEqual(
                    json.loads(result.stdout),
                    core.export_personality(replace(PADI_PERSONALITY_CONFIG, warm=enabled)),
                )


if __name__ == "__main__":
    unittest.main()
