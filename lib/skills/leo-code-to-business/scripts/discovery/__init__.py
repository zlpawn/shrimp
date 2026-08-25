"""Provider-neutral repository signal discovery."""

from .core import (
    AdapterResult,
    DiscoveryAdapter,
    DiscoveryContext,
    RawFinding,
    RejectedFinding,
    detect_repository_languages,
    normalize_adapter_result,
    seed_candidates,
)

__all__ = [
    "AdapterResult",
    "DiscoveryAdapter",
    "DiscoveryContext",
    "RawFinding",
    "RejectedFinding",
    "detect_repository_languages",
    "normalize_adapter_result",
    "seed_candidates",
]
