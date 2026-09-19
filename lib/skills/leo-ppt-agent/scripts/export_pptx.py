#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "python-pptx>=1.0.0",
#     "resvg-py>=0.1.0",
# ]
# ///
"""
Cross-platform SVG to PPTX Exporter (Windows & macOS).
Converts Bento Grid SVG slide decks into high-definition 16:9 PowerPoint presentations (.pptx).
Zero external system libraries required (powered by Rust-based resvg-py and python-pptx).
"""

import argparse
import json
import re
import sys
from io import BytesIO
from pathlib import Path

try:
    import resvg_py
    from pptx import Presentation
    from pptx.util import Inches
except ImportError:
    print(
        "Missing required dependencies. Run with 'uv run scripts/export_pptx.py' "
        "or install via 'uv pip install python-pptx resvg-py'.",
        file=sys.stderr,
    )
    sys.exit(1)


def natural_sort_key(file_path: Path):
    """Sort slide-1, slide-2, slide-10 in natural numerical order."""
    parts = re.split(r"(\d+)", file_path.name)
    return [int(p) if p.isdigit() else p.lower() for p in parts]


def export_svg_to_pptx(
    input_dir: Path,
    output_path: Path,
    title: str = "Presentation",
    scale_factor: float = 2.0,
) -> dict:
    """
    Find all SVG slides in input_dir, render at high DPI, and compile into a 16:9 PPTX.
    """
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")

    # Discover SVG slides
    svg_files = sorted(input_dir.glob("*.svg"), key=natural_sort_key)
    if not svg_files:
        # Check subdirectories like slides/ or output/
        alt_dirs = [input_dir / "output", input_dir / "slides"]
        for alt in alt_dirs:
            if alt.exists():
                svg_files = sorted(alt.glob("*.svg"), key=natural_sort_key)
                if svg_files:
                    break

    if not svg_files:
        raise FileNotFoundError(f"No .svg slide files found in {input_dir}")

    # Standard 16:9 PowerPoint Dimensions
    SLIDE_WIDTH_INCHES = 13.333
    SLIDE_HEIGHT_INCHES = 7.5

    prs = Presentation()
    prs.slide_width = Inches(SLIDE_WIDTH_INCHES)
    prs.slide_height = Inches(SLIDE_HEIGHT_INCHES)
    blank_layout = prs.slide_layouts[6]  # Blank slide

    processed_slides = []
    print(f"📦 Packaging {len(svg_files)} SVG slide(s) into PPTX...")

    for idx, svg_path in enumerate(svg_files, start=1):
        try:
            svg_content = svg_path.read_text(encoding="utf-8")
            
            # Render SVG to high-res PNG bytes
            # Standard viewBox is 1280x720. Scale 2.0x produces 2560x1440 for crisp display.
            png_bytes = resvg_py.svg_to_bytes(svg_content)
            
            slide = prs.slides.add_slide(blank_layout)
            slide.shapes.add_picture(
                BytesIO(png_bytes),
                0,
                0,
                width=Inches(SLIDE_WIDTH_INCHES),
                height=Inches(SLIDE_HEIGHT_INCHES),
            )
            processed_slides.append({
                "index": idx,
                "file": svg_path.name,
                "status": "success",
            })
            print(f"  ✓ Slide {idx:02d}: {svg_path.name}")
        except Exception as err:
            print(f"  ✗ Slide {idx:02d} ({svg_path.name}) failed: {err}", file=sys.stderr)
            processed_slides.append({
                "index": idx,
                "file": svg_path.name,
                "status": "error",
                "error": str(err),
            })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))
    file_size = output_path.stat().st_size

    result = {
        "title": title,
        "total_slides": len(processed_slides),
        "successful_slides": sum(1 for s in processed_slides if s["status"] == "success"),
        "output_file": str(output_path.resolve()),
        "file_size_bytes": file_size,
        "file_size_formatted": f"{file_size / 1024:.1f} KB",
    }
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Convert SVG slide deck to a 16:9 presentation.pptx"
    )
    parser.add_argument(
        "--input-dir",
        "-i",
        type=Path,
        required=True,
        help="Directory containing the slide .svg files (e.g. output/ or slides/)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Path to output .pptx file (default: <input-dir>/presentation.pptx)",
    )
    parser.add_argument(
        "--title",
        "-t",
        default="Presentation",
        help="Presentation title",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output result as JSON",
    )

    args = parser.parse_args()

    output_file = args.output
    if output_file is None:
        output_file = args.input_dir / "presentation.pptx"

    try:
        res = export_svg_to_pptx(
            input_dir=args.input_dir,
            output_path=output_file,
            title=args.title,
        )
        if args.json:
            print(json.dumps(res, ensure_ascii=False, indent=2))
        else:
            print(f"\n🎉 Successfully exported PPTX: {res['output_file']} ({res['file_size_formatted']})")
    except Exception as e:
        print(f"Error during PPTX export: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
