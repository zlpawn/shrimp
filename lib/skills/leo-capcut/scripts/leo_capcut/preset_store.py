from __future__ import annotations

import json
import shutil
import time
from pathlib import Path
from typing import Any, Mapping

from .asset_store import AssetStore
from .errors import PresetError
from .util import is_explicit_preset_intent, looks_like_absolute_path, slugify, write_json


class PresetStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _preset_path(self, preset_id: str) -> Path:
        return self.root / preset_id / "preset.json"

    def list_ids(self) -> list[str]:
        if not self.root.exists():
            return []
        return sorted(
            path.parent.name
            for path in self.root.glob("*/preset.json")
        )

    def load(self, preset_id: str) -> dict[str, Any]:
        path = self._preset_path(preset_id)
        if not path.is_file():
            raise PresetError(f"preset not found: {preset_id}")
        return json.loads(path.read_text(encoding="utf-8"))

    def record_project_edit(self, _edit: Mapping[str, Any]) -> None:
        # Project edits never become personal templates.
        return None

    def save(
        self,
        payload: Mapping[str, Any],
        *,
        explicit: bool,
        intent: str | None = None,
        asset_store: AssetStore | None = None,
    ) -> dict[str, Any]:
        if not explicit or not is_explicit_preset_intent(intent if intent is not None else "保存为模板" if explicit else ""):
            if not explicit:
                raise PresetError("personal templates are only created when the user explicitly asks to save")
            if not is_explicit_preset_intent(intent):
                raise PresetError("personal templates require an explicit save intent")

        preset_id = slugify(str(payload.get("id") or payload.get("name") or "user-preset"))
        inherits = dict(payload.get("inherits") or {})
        overrides = dict(payload.get("overrides") or {})
        assets_in = list(payload.get("assets") or [])
        stored_assets = []
        if assets_in:
            store = asset_store or AssetStore(self.root.parent / "assets")
            for asset in assets_in:
                stored_assets.append(store.ingest(preset_id=preset_id, asset=asset))

        document = {
            "schema_version": "1.0",
            "id": preset_id,
            "name": payload.get("name") or preset_id,
            "inherits": inherits,
            "overrides": overrides,
            "assets": stored_assets,
            "saved_at": int(time.time()),
        }
        path = self._preset_path(preset_id)
        serialized = json.dumps(document, ensure_ascii=False, indent=2)
        if any(looks_like_absolute_path(line) for line in serialized.splitlines()):
            raise PresetError("portable presets cannot contain absolute filesystem paths")
        write_json(path, document)
        return {"id": preset_id, "path": str(path), "document": document}

    def export_pack(self, preset_id: str, destination: Path, asset_store: AssetStore | None = None) -> Path:
        document = self.load(preset_id)
        pack_dir = Path(destination)
        if pack_dir.exists():
            raise FileExistsError(f"export destination already exists: {pack_dir}")
        pack_dir.mkdir(parents=True)
        store = asset_store or AssetStore(self.root.parent / "assets")
        assets = store.export_into(preset_id, pack_dir, list(document.get("assets") or []))
        pack = {
            "schema_version": "1.0",
            "kind": "leo-capcut-preset-pack",
            "preset": {
                **document,
                "assets": assets,
            },
        }
        write_json(pack_dir / "pack.json", pack)
        text = (pack_dir / "pack.json").read_text(encoding="utf-8")
        if "C:\\" in text or "/Users/" in text:
            raise PresetError("exported pack still contains host-specific paths")
        return pack_dir

    def import_pack(
        self,
        pack_dir: Path,
        *,
        conflict: str = "rename",
        asset_store: AssetStore | None = None,
    ) -> dict[str, Any]:
        payload = json.loads((Path(pack_dir) / "pack.json").read_text(encoding="utf-8"))
        preset = dict(payload.get("preset") or {})
        preset_id = str(preset.get("id") or "imported")
        store = asset_store or AssetStore(self.root.parent / "assets")
        existing = self.list_ids()
        if preset_id in existing and conflict not in {"copy", "overwrite"}:
            suffix = 2
            candidate = f"{preset_id}-{suffix}"
            while candidate in existing:
                suffix += 1
                candidate = f"{preset_id}-{suffix}"
            preset_id = candidate
            preset["id"] = preset_id
        assets = store.import_from_pack(preset_id, Path(pack_dir), list(preset.get("assets") or []))
        preset["assets"] = assets
        write_json(self._preset_path(preset_id), preset)
        return preset
