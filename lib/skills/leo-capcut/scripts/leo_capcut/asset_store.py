from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from .util import copy_file, sha256_file, slugify, write_json


class AssetStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def ingest(self, *, preset_id: str, asset: Mapping[str, Any]) -> dict[str, Any]:
        asset_id = slugify(str(asset.get("id") or "asset"))
        mode = str(asset.get("mode") or "managed-copy")
        kind = str(asset.get("kind") or "file")
        logical_uri = f"asset://{preset_id}/{asset_id}"
        record: dict[str, Any] = {
            "id": asset_id,
            "kind": kind,
            "mode": mode,
            "uri": logical_uri,
        }
        if mode == "generated":
            record["generator"] = asset.get("generator") or {}
            return record
        if mode == "external-reference":
            record["external_hint"] = str(asset.get("external_hint") or Path(str(asset.get("source_path") or "")).name)
            return record

        source_raw = asset.get("source_path")
        if not source_raw:
            return record
        source = Path(str(source_raw))
        if not source.is_file():
            # Keep the logical URI only. Host paths must never enter the preset document.
            record["missing_source"] = True
            record["original_filename"] = source.name
            return record
        target_dir = self.root / preset_id
        target = target_dir / f"{asset_id}{source.suffix.lower()}"
        copy_file(source, target)
        record.update(
            {
                "relative_path": str(Path(preset_id) / target.name).replace("\\", "/"),
                "sha256": sha256_file(target),
                "filename": target.name,
            }
        )
        write_json(target_dir / "manifest.json", {"preset_id": preset_id})
        return record

    def resolve(self, uri: str) -> Path | None:
        if not uri.startswith("asset://"):
            path = Path(uri)
            return path if path.is_file() else None
        _, rest = uri.split("://", 1)
        preset_id, _, asset_id = rest.partition("/")
        matches = list((self.root / preset_id).glob(f"{asset_id}.*"))
        return matches[0] if matches else None

    def export_into(self, preset_id: str, destination: Path, assets: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
        exported: list[dict[str, Any]] = []
        for asset in assets:
            item = dict(asset)
            rel = item.get("relative_path")
            if rel:
                source = self.root / Path(str(rel))
                if source.is_file():
                    target = destination / "assets" / Path(str(rel)).name
                    copy_file(source, target)
                    item["pack_path"] = f"assets/{target.name}"
            exported.append(item)
        return exported

    def import_from_pack(self, preset_id: str, pack_dir: Path, assets: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
        imported: list[dict[str, Any]] = []
        for asset in assets:
            item = dict(asset)
            pack_path = item.get("pack_path")
            if pack_path:
                source = pack_dir / str(pack_path)
                if source.is_file():
                    target = self.root / preset_id / source.name
                    copy_file(source, target)
                    item["relative_path"] = str(Path(preset_id) / target.name).replace("\\", "/")
                    item["uri"] = f"asset://{preset_id}/{item['id']}"
                    item["sha256"] = sha256_file(target)
            imported.append(item)
        return imported
