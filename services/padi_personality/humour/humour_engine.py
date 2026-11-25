
"""Main humour engine for PADI."""

from dataclasses import dataclass

from humour.preferences import HumourPreferences
from humour.timing import HumourTiming
from humour.styles import HumourStyle
from conversation.context import ConversationContext


@dataclass(frozen=True)
class HumourDecision:
    """Result of PADI's humour decision."""

    should_use_humour: bool
    style: str = "none"
    intensity: str = "none"
    reason: str = ""


class HumourEngine:
    """Coordinate PADI's humour decisions."""

    def __init__(self, preferences: HumourPreferences | None = None):
        self.preferences = preferences or HumourPreferences()

    def decide(self, context: ConversationContext) -> HumourDecision:
        """Decide whether humour fits the current conversation."""

        if not context.user_message.strip():
            return HumourDecision(False, reason="Empty message")

        if not self.preferences.enabled:
            return HumourDecision(False, reason="Humour disabled")

        if context.is_serious:
            return HumourDecision(False, reason="Serious context")

        timing = HumourTiming.evaluate(context)

        if not timing.should_use_humour:
            return HumourDecision(False, reason=timing.reason)

        style = HumourStyle.select(context)

        return HumourDecision(
            should_use_humour=True,
            style=style.name,
            intensity=self.preferences.intensity,
            reason="Humour fits the conversation",
        )
