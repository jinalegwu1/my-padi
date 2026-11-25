"""Core PADI personality module."""

from .conversation.response_style import build_warmth_guidance
from .conversation.understanding import UNDERSTANDING_GUIDANCE
from .emotions.emotion_recognition import EMOTION_RECOGNITION_GUIDANCE
from .emotions.emotional_responses import EMOTIONAL_RESPONSE_GUIDANCE
from .humour.jokes import JOKE_GUIDANCE
from .humour.playful_teasing import PLAYFUL_TEASING_GUIDANCE
from .humour.storytelling import HUMOROUS_STORYTELLING_GUIDANCE
from .personalities.comedian import COMEDIAN_GUIDANCE
from .personalities.emotional_intelligence import WARMTH_SUPPORT_GUIDANCE
from .personalities.intellectual import INTELLECTUAL_GUIDANCE
from .personality_config import PADI_PERSONALITY_CONFIG, PersonalityConfig


def export_personality(
    config: PersonalityConfig = PADI_PERSONALITY_CONFIG,
) -> dict:
    """Export Go's two-key personality contract without mutating configuration."""

    warmth_guidance = build_warmth_guidance(config)

    guidance = [
        UNDERSTANDING_GUIDANCE,
        warmth_guidance,
    ]

    if config.emotionally_aware:
        guidance.extend(
            [
                EMOTION_RECOGNITION_GUIDANCE,
                EMOTIONAL_RESPONSE_GUIDANCE,
            ]
        )

    if config.funny:
        guidance.extend(
            [
                COMEDIAN_GUIDANCE,
                JOKE_GUIDANCE,
                HUMOROUS_STORYTELLING_GUIDANCE,
            ]
        )

    if config.playful:
        guidance.append(PLAYFUL_TEASING_GUIDANCE)

    if config.intelligent:
        guidance.append(INTELLECTUAL_GUIDANCE)

    return {
        "traits": config.to_dict(),
        # Keep the existing Go wire contract while delivering the composed rules.
        "warmth_guidance": (
            "\n\n".join(section.strip() for section in guidance if section.strip())
            if config.warm
            else ""
        ),
    }
