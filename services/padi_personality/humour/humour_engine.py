
"""Main humour engine for PADI."""

from dataclasses import dataclass

from conversation.context import HumourContext


@dataclass(frozen=True)
class HumourDecision:
    """Result of PADI's humour decision."""

    should_use_humour: bool
    style: str = "none"
    intensity: str = "none"
    reason: str = ""


class HumourEngine:
    """Coordinate PADI's natural and emotionally aware humour."""

    def decide(self, context: HumourContext) -> HumourDecision:
        """Decide whether humour fits the current conversation."""

        if context is None:
            return HumourDecision(
                False,
                reason="Conversation context unavailable",
            )

        if not context.has_content:
            return HumourDecision(
                False,
                reason="Empty message",
            )

        if not context.humour_enabled:
            return HumourDecision(
                False,
                reason="Humour disabled by user preference",
            )

        if context.is_serious:
            return HumourDecision(
                False,
                reason="Serious context requires an empathetic response",
            )

        # Give priority to humour when the user invites it.
        if context.user_invited_humour:
            return HumourDecision(
                True,
                style="playful",
                intensity="natural",
                reason="User invited humour",
            )

        # Avoid repeatedly using humour in consecutive responses.
        if context.previous_humour:
            return HumourDecision(
                False,
                reason="Allowing space between humorous responses",
            )

        return HumourDecision(
            True,
            style="observational",
            intensity="natural",
            reason="A light humorous response is appropriate",
        )
