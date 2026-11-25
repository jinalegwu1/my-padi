
"""Conversation context for PADI's humour engine."""

from dataclasses import dataclass


@dataclass(frozen=True)
class HumourContext:
    """Describe the current conversation before humour is selected."""

    user_message: str
    conversation_history: tuple[str, ...] = ()
    mood: str = "unknown"
    seriousness: str = "normal"
    user_invited_humour: bool = False
    humour_enabled: bool = True
    previous_humour: bool = False

    @property
    def has_content(self) -> bool:
        """Check whether there is a message to respond to."""
        return bool(self.user_message.strip())

    @property
    def is_serious(self) -> bool:
        """Identify conversations where humour should be avoided."""
        serious_contexts = {
            "serious",
            "grief",
            "trauma",
            "crisis",
            "distress",
            "sensitive",
        }
        return (
            self.seriousness.strip().lower() in serious_contexts
            or self.mood.strip().lower() in serious_contexts
        )

    @property
    def allows_humour(self) -> bool:
        """Determine whether humour is permitted in this context."""
        return (
            self.has_content
            and self.humour_enabled
            and not self.is_serious
        )
