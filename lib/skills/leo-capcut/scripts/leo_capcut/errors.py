from __future__ import annotations


class LeoCapcutError(Exception):
    """Base error for the leo-capcut runtime."""


class TimelineValidationError(LeoCapcutError):
    """Raised when a Timeline IR payload is invalid."""


class PresetError(LeoCapcutError):
    """Raised for personal-template policy or storage failures."""


class JianyingBusyError(LeoCapcutError):
    """Raised when Jianying is running and homepage mutation is refused."""


class JianyingCapabilityError(LeoCapcutError):
    """Raised when the current platform adapter cannot publish."""


class JianyingPublishError(LeoCapcutError):
    """Raised when draft generation or registration fails."""
