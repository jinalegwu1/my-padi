"""PADI's core identity, shared by Python and the Go response builder."""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class PersonalityConfig:
    """Enable PADI's foundational personality traits."""

    warm: bool = True
    funny: bool = True
    witty: bool = True
    intelligent: bool = True
    playful: bool = True
    emotionally_aware: bool = True

    def to_dict(self) -> dict[str, bool]:
        """Export the settings without exposing mutable configuration state."""
        return asdict(self)


PADI_PERSONALITY_CONFIG = PersonalityConfig()


if __name__ == "__main__":
    import json

    print(json.dumps(PADI_PERSONALITY_CONFIG.to_dict()))
