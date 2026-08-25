#!/usr/bin/env python3
"""
Entrypoint discovery scanner for leo-code-to-business.
Scans source code (Java/Spring, Go, Python, Node, etc.) to discover all HTTP endpoints,
scheduled tasks, message consumers, and RPC interfaces, producing a canonical inventory.jsonl.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repository_snapshot
from discovery import core
import discover_repository_signals


def extract_java_entries(repo_root: Path) -> List[Dict[str, Any]]:
    """Scans Java source files for HTTP endpoints, Controllers, Scheduled jobs, Commands, and MQ listeners."""
    entries: List[Dict[str, Any]] = []

    method_mapping_pattern = re.compile(
        r"@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*(?:\(\s*(?:value\s*=\s*)?(?:path\s*=\s*)?([\"'][^\"']*[\"']|{[^}]*})?[^)]*\))?",
        re.DOTALL,
    )
    scheduled_pattern = re.compile(r"@Scheduled\s*(?:\([^)]*\))?")
    mq_pattern = re.compile(
        r"@(RocketMQMessageListener|KafkaListener|RabbitListener)\s*(?:\([^)]*\))?"
    )

    java_files = list(repo_root.glob("**/*.java"))
    for file_path in sorted(java_files):
        rel_str = str(file_path.relative_to(repo_root))
        if any(part in rel_str for part in ["/test/", "/target/", "/build/", "/.git/", "/_leo_business/"]):
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        lines = content.splitlines()
        class_name = file_path.stem

        class_prefix = ""
        is_annotated_controller = ("@RestController" in content or "@Controller" in content)
        is_named_controller = class_name.endswith("Controller")
        is_command_or_handler = class_name.endswith("Command") or class_name.endswith("Handler") or class_name.endswith("Job")

        # Class-level RequestMapping
        class_rm_match = re.search(r"@RequestMapping\s*\(\s*(?:value\s*=\s*)?(?:path\s*=\s*)?([\"'][^\"']*[\"']|{[^}]*})", content)
        if class_rm_match:
            raw_path = class_rm_match.group(1).strip("\"{'} ")
            if raw_path and not raw_path.startswith("/"):
                raw_path = "/" + raw_path
            class_prefix = raw_path

        annotated_methods_found = False

        for i, line in enumerate(lines, start=1):
            line_strip = line.strip()

            # HTTP mappings in Controllers
            if is_annotated_controller or is_named_controller:
                match = method_mapping_pattern.search(line_strip)
                if match:
                    annotated_methods_found = True
                    anno_type = match.group(1)
                    raw_method_path = match.group(2) or '""'
                    clean_method_path = raw_method_path.strip("\"{'} ")
                    if clean_method_path and not clean_method_path.startswith("/"):
                        clean_method_path = "/" + clean_method_path
                    
                    full_route = f"{class_prefix}{clean_method_path}" or "/"
                    if not full_route.startswith("/"):
                        full_route = "/" + full_route

                    http_method = "ANY"
                    if "Get" in anno_type:
                        http_method = "GET"
                    elif "Post" in anno_type:
                        http_method = "POST"
                    elif "Put" in anno_type:
                        http_method = "PUT"
                    elif "Delete" in anno_type:
                        http_method = "DELETE"
                    elif "Patch" in anno_type:
                        http_method = "PATCH"

                    symbol_name = ""
                    for next_line in lines[i - 1 : min(i + 10, len(lines))]:
                        sym_match = re.search(r"(?:public|protected|private)\s+[\w<>,\[\]\s]+\s+(\w+)\s*\(", next_line)
                        if sym_match:
                            symbol_name = sym_match.group(1)
                            break
                    
                    symbol_ref = f"{class_name}.{symbol_name}" if symbol_name else class_name

                    classification = "business"
                    route_lower = full_route.lower()
                    if any(kw in route_lower for kw in ["/backdoor/", "/internal/", "/ops/", "/admin/", "/manage/"]):
                        classification = "operations"
                    elif any(kw in route_lower for kw in ["/health", "/ping", "/metrics", "/welcome", "/actuator"]):
                        classification = "technical_infrastructure"
                    elif any(kw in route_lower for kw in ["/redo", "/retry", "/relink", "/compensate"]):
                        classification = "compensation_or_retry"

                    safe_slug = re.sub(r"[^a-zA-Z0-9]+", "-", f"{http_method}-{full_route}").strip("-")
                    fact_id = f"FACT-route-{safe_slug[:60]}"

                    entries.append({
                        "id": fact_id,
                        "name": f"{http_method} {full_route}",
                        "kind": "http_entry",
                        "classification": classification,
                        "mapped_node_ids": [],
                        "resolution_status": "unresolved",
                        "source_location": {
                            "path": rel_str,
                            "symbol": symbol_ref,
                            "start_line": i,
                            "end_line": min(i + 20, len(lines))
                        }
                    })

            # Scheduled Jobs
            if scheduled_pattern.search(line_strip) or ("implements" in line_strip and "Job" in line_strip):
                symbol_name = ""
                for next_line in lines[i - 1 : min(i + 10, len(lines))]:
                    sym_match = re.search(r"(?:public|protected|private)\s+[\w<>,\[\]\s]+\s+(\w+)\s*\(", next_line)
                    if sym_match:
                        symbol_name = sym_match.group(1)
                        break
                symbol_ref = f"{class_name}.{symbol_name}" if symbol_name else class_name
                safe_slug = re.sub(r"[^a-zA-Z0-9]+", "-", symbol_ref).strip("-")
                entries.append({
                    "id": f"FACT-job-{safe_slug[:60]}",
                    "name": symbol_ref,
                    "kind": "scheduled_job",
                    "classification": "compensation_or_retry" if "redo" in symbol_ref.lower() or "retry" in symbol_ref.lower() else "operations",
                    "mapped_node_ids": [],
                    "resolution_status": "unresolved",
                    "source_location": {
                        "path": rel_str,
                        "symbol": symbol_ref,
                        "start_line": i,
                        "end_line": min(i + 20, len(lines))
                    }
                })

            # MQ Listeners
            if mq_pattern.search(line_strip):
                safe_slug = re.sub(r"[^a-zA-Z0-9]+", "-", class_name).strip("-")
                entries.append({
                    "id": f"FACT-event-{safe_slug[:60]}",
                    "name": class_name,
                    "kind": "event_consumer",
                    "classification": "business",
                    "mapped_node_ids": [],
                    "resolution_status": "unresolved",
                    "source_location": {
                        "path": rel_str,
                        "symbol": class_name,
                        "start_line": i,
                        "end_line": min(i + 20, len(lines))
                    }
                })

        # Fallback for plain Controller classes or Command classes without Spring annotations
        if (is_named_controller or is_command_or_handler) and not annotated_methods_found:
            for i, line in enumerate(lines, start=1):
                # Match public method declarations (not constructor)
                sym_match = re.search(r"public\s+[\w<>,\[\]\s]+\s+(\w+)\s*\([^)]*\)\s*[{;]", line)
                if sym_match:
                    symbol_name = sym_match.group(1)
                    if symbol_name == class_name:
                        continue  # skip constructor
                    symbol_ref = f"{class_name}.{symbol_name}"
                    safe_slug = re.sub(r"[^a-zA-Z0-9]+", "-", symbol_ref).strip("-")
                    
                    kind = "command_entry" if is_command_or_handler else "http_entry"
                    classification = "operations" if is_command_or_handler or "repair" in symbol_ref.lower() else "business"
                    
                    entries.append({
                        "id": f"FACT-entry-{safe_slug[:60]}",
                        "name": symbol_ref,
                        "kind": kind,
                        "classification": classification,
                        "mapped_node_ids": [],
                        "resolution_status": "unresolved",
                        "source_location": {
                            "path": rel_str,
                            "symbol": symbol_ref,
                            "start_line": i,
                            "end_line": min(i + 20, len(lines))
                        }
                    })

    seen_ids = set()
    unique_entries = []
    for entry in entries:
        if entry["id"] not in seen_ids:
            seen_ids.add(entry["id"])
            unique_entries.append(entry)

    return unique_entries


def discover_all_entrypoints(repo_root: Path) -> List[Dict[str, Any]]:
    """Discover trigger entries through the v2 orchestrator and emit v1 records."""
    root = Path(repo_root).resolve()
    snapshot = repository_snapshot.capture_snapshot(root)
    adapters: list[core.DiscoveryAdapter] = []
    legacy_adapter: LegacyJavaEntrypointAdapter | None = None
    if list(root.glob("**/*.java")):
        legacy_adapter = LegacyJavaEntrypointAdapter(root)
        adapters.append(legacy_adapter)
    result = discover_repository_signals.run_discovery(
        root,
        snapshot,
        adapters=adapters,
    )
    if legacy_adapter is None:
        return []
    entries: list[dict[str, Any]] = []
    for signal in result["inventory"]:
        if signal["signal_class"] != "trigger_entry":
            continue
        locator = _finding_locator(signal["source_location"])
        legacy = legacy_adapter.legacy_by_locator[locator]
        entries.append(dict(legacy))
    return entries


def _finding_locator(source_location: dict[str, Any]) -> str:
    return f"{source_location['path']}:{source_location.get('symbol', '')}"


class LegacyJavaEntrypointAdapter:
    """Temporary adapter retaining the v1 Java scanner until Task 5."""

    adapter_id = "legacy-java-entrypoints"
    adapter_version = "1.0"
    claimed_languages = {"java"}
    claimed_frameworks = {"spring", "plain-java"}
    supported_signal_kinds = {
        "http_entry",
        "scheduled_job",
        "event_consumer",
        "command_entry",
    }

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root
        entries = extract_java_entries(repo_root)
        self.legacy_by_locator = {
            _finding_locator(entry["source_location"]): entry for entry in entries
        }

    def discover(self, context: core.DiscoveryContext) -> core.AdapterResult:
        findings = []
        for locator, entry in self.legacy_by_locator.items():
            importance = (
                "high"
                if entry["classification"] in {"business", "compensation_or_retry"}
                else "normal"
            )
            findings.append(
                core.RawFinding(
                    signal_class="trigger_entry",
                    kind=entry["kind"],
                    locator=locator,
                    name=entry["name"],
                    source_location=entry["source_location"],
                    framework_identity=entry["name"],
                    structural_importance=importance,
                    classification=entry["classification"],
                )
            )
        return core.AdapterResult(
            findings=findings,
            rejected=[],
            unsupported_constructs=[],
            truncated=False,
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Discover all entrypoints across a repository into inventory.jsonl"
    )
    parser.add_argument(
        "--repo",
        type=Path,
        required=True,
        help="Path to repository root",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Path to output inventory.jsonl file",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output JSON summary to stdout",
    )

    args = parser.parse_args()
    repo_root = args.repo.resolve()
    if not repo_root.exists() or not repo_root.is_dir():
        print(f"Error: repo path {repo_root} does not exist", file=sys.stderr)
        return 1

    entries = discover_all_entrypoints(repo_root)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            for entry in entries:
                f.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")

    summary = {
        "repository": str(repo_root),
        "total_entrypoints": len(entries),
        "by_kind": {},
        "by_classification": {},
    }
    for e in entries:
        k = e.get("kind", "unknown")
        c = e.get("classification", "unknown")
        summary["by_kind"][k] = summary["by_kind"].get(k, 0) + 1
        summary["by_classification"][c] = summary["by_classification"].get(c, 0) + 1

    if args.json or not args.output:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    else:
        print(f"Discovered {len(entries)} entrypoints. Written to {args.output}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
