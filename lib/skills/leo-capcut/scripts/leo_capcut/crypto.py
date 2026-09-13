from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any


def vendor_crypto_path() -> Path:
    return Path(__file__).resolve().parents[1] / "vendor" / "pyJianYingDraft" / "draft_crypto.py"


def load_draft_crypto() -> ModuleType:
    module_name = "_leo_capcut_vendor_draft_crypto"
    if module_name in sys.modules:
        return sys.modules[module_name]
    path = vendor_crypto_path()
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load vendor crypto module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class IsolatedJianyingCodec:
    """Encrypt/decrypt draft JSON via the vendored Jianying DLL bridge."""

    def __init__(self, install_dir: Path):
        self.install_dir = Path(install_dir)
        self._crypto = load_draft_crypto()

    def encode(self, payload: dict[str, Any]) -> bytes:
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        encoded = self._crypto.encrypt_draft_bytes(
            serialized,
            jy_install_dir=str(self.install_dir),
            isolated=True,
            validate_roundtrip=True,
        )
        if encoded.lstrip().startswith(b"{"):
            raise RuntimeError("Jianying codec returned plaintext instead of encrypted bytes")
        return encoded

    def decode(self, raw: bytes) -> dict[str, Any]:
        plaintext = self._crypto.decrypt_draft_bytes(
            raw,
            jy_install_dir=str(self.install_dir),
            isolated=True,
        )
        return json.loads(plaintext.decode("utf-8"))
