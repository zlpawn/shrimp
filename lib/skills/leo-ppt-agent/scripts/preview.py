#!/usr/bin/env python3
"""
Cross-platform HTML Presentation Preview Opener.
Works seamlessly on Windows, macOS, and Linux.
"""
import sys
import webbrowser
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python preview.py <path_to_index.html>")
        sys.exit(1)
        
    target_path = Path(sys.argv[1]).resolve()
    if not target_path.exists():
        print(f"Error: Target file not found: {target_path}", file=sys.stderr)
        sys.exit(1)
        
    target_uri = target_path.as_uri()
    print(f"Opening presentation preview in default browser: {target_uri}")
    webbrowser.open(target_uri)

if __name__ == "__main__":
    main()
