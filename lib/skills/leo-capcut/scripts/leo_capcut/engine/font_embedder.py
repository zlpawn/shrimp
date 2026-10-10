from __future__ import annotations
import shutil
import uuid
from pathlib import Path
from typing import Any

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
    return {
        "id": font_id,
        "title": meta["title"],
        "path": str(target_path),
        "relative_path": f"resources/fonts/{font_path.name}",
        "resource_type": "font",
        "type": "font",
    }
