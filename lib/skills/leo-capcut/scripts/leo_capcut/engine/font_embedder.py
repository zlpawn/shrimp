from __future__ import annotations
import json
import shutil
import uuid
from pathlib import Path
from typing import Any

from ..crypto import IsolatedJianyingCodec
from ..detect import detect_environment

def parse_font_metadata(font_path: Path) -> dict[str, str]:
    """Extract font title and basic identification from file path."""
    p = Path(font_path)
    stem = p.stem
    return {
        "title": stem,
        "family_name": stem,
        "file_name": p.name,
        "extension": p.suffix.lower(),
    }

def embed_font_into_draft(draft_dir: Path, font_path: Path) -> dict[str, Any]:
    """Copy font file into draft folder resources/fonts and return font material metadata."""
    font_path = Path(font_path).resolve()
    if not font_path.is_file():
        raise FileNotFoundError(f"font file not found: {font_path}")
    
    meta = parse_font_metadata(font_path)
    fonts_dir = Path(draft_dir) / "resources" / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    
    target_path = fonts_dir / font_path.name
    if not target_path.exists() or target_path.stat().st_size != font_path.stat().st_size:
        shutil.copy2(font_path, target_path)
    
    font_id = uuid.uuid4().hex
    font_material = {
        "id": font_id,
        "title": meta["title"],
        "path": str(target_path),
        "relative_path": f"resources/fonts/{font_path.name}",
        "resource_type": "font",
        "type": "font",
    }

    draft_content_file = Path(draft_dir) / "draft_content.json"
    if draft_content_file.is_file():
        raw = draft_content_file.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        is_plain = raw.lstrip().startswith(b"{")
        if is_plain:
            content = json.loads(raw.decode("utf-8"))
            codec = None
        else:
            env = detect_environment()
            install_dir = env.get("install_dir")
            if not install_dir:
                raise RuntimeError("Cannot decrypt draft: Jianying install directory not found")
            codec = IsolatedJianyingCodec(Path(install_dir))
            content = codec.decode(raw)

        materials = content.setdefault("materials", {})
        fonts = materials.setdefault("fonts", [])
        existing = next(
            (f for f in fonts if f.get("title") == font_material["title"] or f.get("path") == font_material["path"]),
            None,
        )
        if existing:
            existing.update(font_material)
        else:
            fonts.append(font_material)

        if is_plain:
            draft_content_file.write_text(
                json.dumps(content, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        else:
            assert codec is not None
            encoded_bytes = codec.encode(content)
            verified = codec.decode(encoded_bytes)
            if "tracks" not in verified or "materials" not in verified:
                raise RuntimeError("Crypto fuse triggered: round-trip node verification failed")
            draft_content_file.write_bytes(encoded_bytes)

    return font_material
