#!/usr/bin/env python3
"""Deterministic safety and validation gates for leo-lesson-to-skill."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any


SKILL_NAME_RE = re.compile(r"^leo-[a-z0-9]+(?:-[a-z0-9]+)*$")
EVIDENCE_TYPES = {"verbatim", "transcribed", "visual", "synthesized"}
CONFIDENCE_LEVELS = {"high", "medium", "low"}
CONFLICT_STATES = {"none", "open", "resolved_by_user"}
RUN_STATES = {
    "initialized",
    "acquired",
    "acquired_failed",
    "transcribed",
    "transcribed_failed",
    "evidence_extracted",
    "evidence_extracted_failed",
    "methodology_extracted",
    "methodology_extracted_failed",
    "skill_specified",
    "skill_specified_failed",
    "skill_generated",
    "skill_generated_failed",
    "testing",
    "testing_failed",
    "passed",
    "published",
    "publish_failed",
    "cleanup_pending",
    "cleaned",
    "completed_cleanup_skipped",
    "cleanup_failed",
}
STATE_TRANSITIONS = {
    "initialized": {"acquired", "acquired_failed"},
    "acquired": {"transcribed", "transcribed_failed"},
    "acquired_failed": {"acquired"},
    "transcribed": {"evidence_extracted", "evidence_extracted_failed"},
    "transcribed_failed": {"transcribed"},
    "evidence_extracted": {
        "methodology_extracted",
        "methodology_extracted_failed",
    },
    "evidence_extracted_failed": {"evidence_extracted"},
    "methodology_extracted": {"skill_specified", "skill_specified_failed"},
    "skill_specified": {"skill_generated", "skill_generated_failed"},
    "skill_specified_failed": {"skill_specified"},
    "methodology_extracted_failed": {"methodology_extracted"},
    "skill_generated": {"testing", "testing_failed"},
    "skill_generated_failed": {"skill_generated"},
    "testing": {"passed", "testing_failed"},
    "testing_failed": {"testing"},
    "passed": {"published", "publish_failed"},
    "publish_failed": {"passed"},
    "published": {"cleanup_pending"},
    "cleanup_pending": {
        "cleaned",
        "cleanup_failed",
        "completed_cleanup_skipped",
    },
    "cleanup_failed": {"cleanup_pending"},
    "cleaned": set(),
    "completed_cleanup_skipped": set(),
}


class ValidationError(Exception):
    """Raised when an artifact violates a workflow contract."""


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Cannot read valid JSON from {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValidationError(f"{path} must contain a JSON object")
    return data


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}.partial")
    partial.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(partial, path)


def canonical_sha256(data: Any) -> str:
    payload = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def require(data: dict[str, Any], keys: list[str], label: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise ValidationError(
            f"{label} missing required fields: {', '.join(missing)}"
        )


def normalized(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def is_within(child: Path, parent: Path) -> bool:
    try:
        normalized(child).relative_to(normalized(parent))
        return True
    except ValueError:
        return False


def has_reparse_point(path: Path) -> bool:
    try:
        attrs = getattr(path.lstat(), "st_file_attributes", 0)
    except OSError:
        return False
    return bool(attrs & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def validate_manifest_data(data: dict[str, Any]) -> None:
    require(
        data,
        [
            "schema_version",
            "run_id",
            "status",
            "created_at",
            "platform",
            "source_inputs",
            "temp_root",
            "permanent_assets",
            "temporary_files",
        ],
        "manifest",
    )
    if data["schema_version"] != "1.0":
        raise ValidationError("manifest.schema_version must be 1.0")
    if data["platform"] not in {"windows", "macos", "linux"}:
        raise ValidationError(
            "manifest.platform must be windows, macos, or linux"
        )
    if data["status"] not in RUN_STATES:
        raise ValidationError(f"invalid manifest status: {data['status']}")
    if not isinstance(data["source_inputs"], list) or not data["source_inputs"]:
        raise ValidationError("manifest.source_inputs must be a non-empty list")
    if not Path(data["temp_root"]).is_absolute():
        raise ValidationError("manifest.temp_root must be absolute")
    if not isinstance(data["permanent_assets"], list):
        raise ValidationError("manifest.permanent_assets must be a list")
    if not isinstance(data["temporary_files"], list):
        raise ValidationError("manifest.temporary_files must be a list")
    for item in data["temporary_files"]:
        if not isinstance(item, dict):
            raise ValidationError("temporary_files entries must be objects")
        require(
            item,
            ["path", "created_by_run", "size_bytes", "status"],
            "temporary file",
        )
        if not Path(item["path"]).is_absolute():
            raise ValidationError(
                f"temporary file path must be absolute: {item['path']}"
            )


def validate_ir_data(data: dict[str, Any]) -> set[str]:
    require(
        data,
        [
            "schema_version",
            "source",
            "transcript",
            "visual_evidence",
            "uncertain_items",
        ],
        "IR",
    )
    if data["schema_version"] != "1.0":
        raise ValidationError("IR.schema_version must be 1.0")
    source = data["source"]
    require(source, ["type", "uris", "metadata"], "IR.source")
    if source["type"] != "video":
        raise ValidationError("IR.source.type must be video")
    if not isinstance(source["uris"], list) or not source["uris"]:
        raise ValidationError("IR.source.uris must be non-empty")

    metadata = source["metadata"]
    require(
        metadata,
        [
            "video_count",
            "duration_seconds",
            "asr_status",
            "visual_audit_status",
        ],
        "IR.source.metadata",
    )
    if metadata["asr_status"] != "complete":
        raise ValidationError("IR cannot pass while asr_status is not complete")
    if metadata["visual_audit_status"] not in {
        "complete",
        "blocked",
        "not_applicable",
        "failed",
    }:
        raise ValidationError("invalid visual_audit_status")
    durations = metadata["duration_seconds"]
    if (
        metadata["video_count"] != len(source["uris"])
        or not isinstance(durations, list)
        or len(durations) != len(source["uris"])
    ):
        raise ValidationError(
            "video_count, uris, and duration_seconds lengths must match"
        )
    if any(
        not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0
        for value in durations
    ):
        raise ValidationError("all video durations must be positive numbers")

    transcript = data["transcript"]
    segments = transcript.get("segments") if isinstance(transcript, dict) else None
    if not isinstance(segments, list) or not segments:
        raise ValidationError("IR transcript.segments must be non-empty")

    evidence_refs: set[str] = set()
    last_start_by_video: dict[str, float] = {}
    def duration_for_evidence(evidence_id: str) -> float:
        match = re.match(r"^V([1-9][0-9]*)-", evidence_id)
        index = int(match.group(1)) - 1 if match else 0
        if index >= len(durations):
            raise ValidationError(
                f"evidence ID references unknown video: {evidence_id}"
            )
        return float(durations[index])

    for segment in segments:
        if not isinstance(segment, dict):
            raise ValidationError("transcript segments must be objects")
        require(segment, ["id", "start", "end", "text"], "segment")
        segment_id = str(segment["id"])
        if segment_id in evidence_refs:
            raise ValidationError(f"duplicate evidence ID: {segment_id}")
        if not str(segment["text"]).strip():
            raise ValidationError(f"empty transcript text: {segment_id}")
        start, end = segment["start"], segment["end"]
        if (
            not isinstance(start, (int, float))
            or isinstance(start, bool)
            or not isinstance(end, (int, float))
            or isinstance(end, bool)
            or start < 0
            or end <= start
        ):
            raise ValidationError(f"invalid timestamps for {segment_id}")
        if end > duration_for_evidence(segment_id) + 0.5:
            raise ValidationError(
                f"segment exceeds video duration: {segment_id}"
            )
        prefix = (
            segment_id.split("-ASR-", 1)[0]
            if "-ASR-" in segment_id
            else "single"
        )
        if start < last_start_by_video.get(prefix, -1):
            raise ValidationError(
                f"non-monotonic transcript timestamps near {segment_id}"
            )
        last_start_by_video[prefix] = float(start)
        evidence_refs.add(segment_id)

    visual = data["visual_evidence"]
    frames = visual.get("frames") if isinstance(visual, dict) else None
    if not isinstance(frames, list):
        raise ValidationError("IR visual_evidence.frames must be a list")
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValidationError("visual frames must be objects")
        require(
            frame,
            ["id", "timestamp", "visual_status", "multimodal", "ocr"],
            "frame",
        )
        frame_id = str(frame["id"])
        if frame_id in evidence_refs:
            raise ValidationError(f"duplicate evidence ID: {frame_id}")
        timestamp = frame["timestamp"]
        if (
            not isinstance(timestamp, (int, float))
            or isinstance(timestamp, bool)
            or timestamp < 0
        ):
            raise ValidationError(f"invalid frame timestamp: {frame_id}")
        if timestamp > duration_for_evidence(frame_id) + 0.5:
            raise ValidationError(
                f"frame exceeds video duration: {frame_id}"
            )
        visual_status = frame["visual_status"]
        if visual_status not in {
            "multimodal_and_ocr",
            "multimodal_only",
            "ocr_only",
            "not_audited",
        }:
            raise ValidationError(
                f"invalid visual_status for {frame_id}"
            )
        multimodal = frame["multimodal"]
        ocr = frame["ocr"]
        if not isinstance(multimodal, dict) or not isinstance(ocr, dict):
            raise ValidationError(
                f"visual evidence channels must be objects: {frame_id}"
            )
        require(multimodal, ["status", "description"], "multimodal channel")
        require(ocr, ["status", "text"], "OCR channel")
        if multimodal["status"] not in {
            "complete",
            "blocked",
            "failed",
            "not_run",
        }:
            raise ValidationError(
                f"invalid multimodal status for {frame_id}"
            )
        if ocr["status"] not in {
            "complete",
            "blocked",
            "failed",
            "not_run",
        }:
            raise ValidationError(f"invalid OCR status for {frame_id}")
        multimodal_complete = multimodal["status"] == "complete"
        ocr_complete = ocr["status"] == "complete"
        expected_channels = {
            "multimodal_and_ocr": (True, True),
            "multimodal_only": (True, False),
            "ocr_only": (False, True),
            "not_audited": (False, False),
        }
        if (multimodal_complete, ocr_complete) != expected_channels[visual_status]:
            raise ValidationError(
                f"visual_status does not match channels for {frame_id}"
            )
        evidence_refs.add(frame_id)
    return evidence_refs


def methodology_items(data: dict[str, Any]):
    for section in (
        "frameworks",
        "steps",
        "principles",
        "templates",
        "anti_patterns",
    ):
        values = data.get(section)
        if not isinstance(values, list):
            raise ValidationError(f"methodology.{section} must be a list")
        for item in values:
            yield section, item


def validate_methodology_data(
    data: dict[str, Any],
    evidence_refs: set[str] | None = None,
) -> None:
    require(
        data,
        [
            "schema_version",
            "course_topic",
            "target_scenario",
            "frameworks",
            "steps",
            "principles",
            "templates",
            "anti_patterns",
            "uncertain_items",
        ],
        "methodology",
    )
    if data["schema_version"] != "1.0":
        raise ValidationError("methodology.schema_version must be 1.0")
    if not str(data["target_scenario"]).strip():
        raise ValidationError("methodology.target_scenario must be selected")

    item_ids: set[str] = set()
    item_count = 0
    for section, item in methodology_items(data):
        item_count += 1
        if not isinstance(item, dict):
            raise ValidationError(f"methodology.{section} entries must be objects")
        require(
            item,
            [
                "id",
                "source_refs",
                "evidence_type",
                "confidence",
                "conflict_status",
            ],
            f"{section} item",
        )
        item_id = str(item["id"])
        if item_id in item_ids:
            raise ValidationError(f"duplicate methodology item ID: {item_id}")
        item_ids.add(item_id)
        refs = item["source_refs"]
        if (
            not isinstance(refs, list)
            or not refs
            or len(refs) != len(set(refs))
        ):
            raise ValidationError(
                f"{item_id} must have unique, non-empty source_refs"
            )
        if item["evidence_type"] not in EVIDENCE_TYPES:
            raise ValidationError(f"invalid evidence_type for {item_id}")
        if item["confidence"] not in CONFIDENCE_LEVELS:
            raise ValidationError(f"invalid confidence for {item_id}")
        if item["conflict_status"] not in CONFLICT_STATES:
            raise ValidationError(f"invalid conflict_status for {item_id}")
        if evidence_refs is not None:
            missing = sorted(set(refs) - evidence_refs)
            if missing:
                raise ValidationError(
                    f"{item_id} references missing evidence: {', '.join(missing)}"
                )
    if item_count == 0:
        raise ValidationError(
            "methodology must contain at least one evidence-backed item"
        )


def methodology_ids(data: dict[str, Any]) -> set[str]:
    validate_methodology_data(data)
    return {
        str(item["id"])
        for _, item in methodology_items(data)
    }


def validate_skill_spec_data(
    data: dict[str, Any],
    methodology_refs: set[str] | None = None,
) -> None:
    require(
        data,
        [
            "schema_version",
            "skill_name",
            "target_scenario",
            "skill_type",
            "methodology_refs",
            "workflow",
            "required_elements",
            "anti_patterns",
            "freedom_policy",
            "acceptance_thresholds",
        ],
        "skill spec",
    )
    if data["schema_version"] != "1.0":
        raise ValidationError("skill spec schema_version must be 1.0")
    if not SKILL_NAME_RE.fullmatch(str(data["skill_name"])):
        raise ValidationError("skill spec skill_name must be leo- kebab-case")
    if not str(data["target_scenario"]).strip():
        raise ValidationError("skill spec target_scenario must be non-empty")
    if data["skill_type"] not in {"execution", "guidance"}:
        raise ValidationError("skill_type must be execution or guidance")

    top_refs = data["methodology_refs"]
    if (
        not isinstance(top_refs, list)
        or not top_refs
        or len(top_refs) != len(set(top_refs))
    ):
        raise ValidationError(
            "skill spec methodology_refs must be unique and non-empty"
        )

    workflow = data["workflow"]
    if not isinstance(workflow, list) or not workflow:
        raise ValidationError("skill spec workflow must be non-empty")
    step_ids: set[str] = set()
    orders: list[int] = []
    referenced: set[str] = set(str(value) for value in top_refs)
    for step in workflow:
        if not isinstance(step, dict):
            raise ValidationError("skill spec workflow entries must be objects")
        require(
            step,
            [
                "id",
                "order",
                "name",
                "methodology_refs",
                "inputs",
                "actions",
                "outputs",
                "checkpoints",
            ],
            "skill spec workflow step",
        )
        step_id = str(step["id"])
        if step_id in step_ids:
            raise ValidationError(f"duplicate workflow step ID: {step_id}")
        step_ids.add(step_id)
        order = step["order"]
        if not isinstance(order, int) or isinstance(order, bool) or order < 1:
            raise ValidationError(f"invalid workflow order for {step_id}")
        orders.append(order)
        refs = step["methodology_refs"]
        if not isinstance(refs, list) or not refs:
            raise ValidationError(
                f"{step_id} must have methodology_refs"
            )
        referenced.update(str(value) for value in refs)
        for field in ("inputs", "actions", "outputs", "checkpoints"):
            values = step[field]
            if not isinstance(values, list) or not values:
                raise ValidationError(
                    f"{step_id}.{field} must be a non-empty list"
                )
    if orders != list(range(1, len(workflow) + 1)):
        raise ValidationError(
            "workflow orders must be unique, sequential, and list-ordered"
        )
    if data["skill_type"] == "guidance" and len(workflow) > 1:
        raise ValidationError(
            "guidance skills must use one non-sequential guidance workflow block"
        )

    for field in ("required_elements", "anti_patterns"):
        values = data[field]
        if not isinstance(values, list) or not values:
            raise ValidationError(f"skill spec {field} must be non-empty")

    freedom = data["freedom_policy"]
    if not isinstance(freedom, dict):
        raise ValidationError("freedom_policy must be an object")
    require(freedom, ["locked", "free"], "freedom_policy")
    required_locks = {
        "workflow_order",
        "checkpoints",
        "required_elements",
        "anti_patterns",
    }
    if not required_locks.issubset(set(freedom["locked"])):
        raise ValidationError(
            "freedom_policy.locked must protect the full methodology skeleton"
        )
    if set(freedom["locked"]) & set(freedom["free"]):
        raise ValidationError(
            "freedom_policy locked and free values must not overlap"
        )

    thresholds = data["acceptance_thresholds"]
    if not isinstance(thresholds, dict):
        raise ValidationError("acceptance_thresholds must be an object")
    exact_thresholds = {
        "methodology_coverage": 1.0,
        "required_elements_coverage": 1.0,
        "anti_patterns_coverage": 1.0,
        "required_test_pass_rate": 1.0,
        "unsupported_claims_max": 0,
        "require_exact_step_order": True,
        "require_spec_hash_match": True,
        "require_open_conflicts_reported": True,
    }
    for key, expected in exact_thresholds.items():
        if thresholds.get(key) != expected:
            raise ValidationError(
                f"acceptance threshold {key} must equal {expected!r}"
            )
    if methodology_refs is not None:
        missing = sorted(referenced - methodology_refs)
        if missing:
            raise ValidationError(
                "skill spec references missing methodology items: "
                + ", ".join(missing)
            )
        uncovered = sorted(methodology_refs - referenced)
        if uncovered:
            raise ValidationError(
                "skill spec does not cover methodology items: "
                + ", ".join(uncovered)
            )


def validate_test_report_data(data: dict[str, Any]) -> None:
    require(
        data,
        [
            "schema_version",
            "skill_name",
            "skill_spec_hash",
            "frozen_suite",
            "frozen_suite_hash",
            "test_rounds",
            "final_status",
            "evaluation_mode",
            "consistency_metrics",
        ],
        "test report",
    )
    if data["schema_version"] != "1.0":
        raise ValidationError("test report schema_version must be 1.0")
    if not SKILL_NAME_RE.fullmatch(str(data["skill_name"])):
        raise ValidationError("test report skill_name must be leo- kebab-case")
    if not re.fullmatch(r"[a-f0-9]{64}", str(data["skill_spec_hash"])):
        raise ValidationError(
            "test report skill_spec_hash must be a SHA-256 hex digest"
        )
    if data["evaluation_mode"] not in {
        "deterministic",
        "self_eval",
        "independent_eval",
    }:
        raise ValidationError("invalid evaluation_mode")
    metrics = data["consistency_metrics"]
    if not isinstance(metrics, dict):
        raise ValidationError("consistency_metrics must be an object")
    exact_metrics = {
        "methodology_coverage": 1.0,
        "step_order_match": True,
        "required_elements_coverage": 1.0,
        "anti_patterns_coverage": 1.0,
        "unsupported_claims": 0,
        "open_conflicts_reported": True,
        "required_test_pass_rate": 1.0,
        "spec_hash_match": True,
    }
    for key, expected in exact_metrics.items():
        if key not in metrics:
            raise ValidationError(f"missing consistency metric: {key}")
        if data["final_status"] == "passed" and metrics[key] != expected:
            raise ValidationError(
                f"passed report requires {key} == {expected!r}"
            )
    frozen_suite = data["frozen_suite"]
    if not isinstance(frozen_suite, list) or len(frozen_suite) < 2:
        raise ValidationError(
            "frozen_suite must contain at least two scenarios"
        )
    frozen_shape: dict[str, tuple[bool, tuple[str, ...]]] = {}
    required_count = 0
    for scenario in frozen_suite:
        if not isinstance(scenario, dict):
            raise ValidationError("frozen suite scenarios must be objects")
        require(
            scenario,
            [
                "scenario_id",
                "required",
                "description",
                "user_input",
                "check_ids",
            ],
            "frozen suite scenario",
        )
        scenario_id = str(scenario["scenario_id"])
        check_ids = scenario["check_ids"]
        if (
            scenario_id in frozen_shape
            or not isinstance(check_ids, list)
            or not check_ids
            or len(check_ids) != len(set(check_ids))
        ):
            raise ValidationError(
                f"invalid or duplicate frozen scenario: {scenario_id}"
            )
        if scenario["required"]:
            required_count += 1
        frozen_shape[scenario_id] = (
            bool(scenario["required"]),
            tuple(sorted(str(value) for value in check_ids)),
        )
    if required_count < 2:
        raise ValidationError(
            "frozen_suite must contain at least two required scenarios"
        )
    expected_hash = canonical_sha256(frozen_suite)
    if data["frozen_suite_hash"] != expected_hash:
        raise ValidationError(
            "frozen_suite_hash does not match frozen_suite"
        )

    rounds = data["test_rounds"]
    if not isinstance(rounds, list) or not 1 <= len(rounds) <= 3:
        raise ValidationError("test report must contain 1 to 3 rounds")
    for expected_round, round_data in enumerate(rounds, start=1):
        if not isinstance(round_data, dict):
            raise ValidationError("test rounds must be objects")
        require(
            round_data,
            ["round", "scenarios", "failed_items", "fix_applied"],
            "test round",
        )
        if round_data["round"] != expected_round:
            raise ValidationError(
                "test rounds must be sequential starting at 1"
            )
        scenarios = round_data["scenarios"]
        if not isinstance(scenarios, list) or len(scenarios) < 2:
            raise ValidationError(
                "each round must contain at least two scenarios"
            )
        round_shape: dict[str, tuple[bool, tuple[str, ...]]] = {}
        for scenario in scenarios:
            if not isinstance(scenario, dict):
                raise ValidationError("test scenarios must be objects")
            require(
                scenario,
                ["scenario_id", "required", "checks"],
                "test scenario",
            )
            checks = scenario["checks"]
            if not isinstance(checks, dict) or not checks:
                raise ValidationError(
                    f"{scenario['scenario_id']} must contain checks"
                )
            if any(not isinstance(value, bool) for value in checks.values()):
                raise ValidationError(
                    f"{scenario['scenario_id']} checks must be booleans"
                )
            scenario_id = str(scenario["scenario_id"])
            if scenario_id in round_shape:
                raise ValidationError(
                    f"duplicate scenario_id in round: {scenario_id}"
                )
            round_shape[scenario_id] = (
                bool(scenario["required"]),
                tuple(sorted(checks)),
            )
        if round_shape != frozen_shape:
            raise ValidationError(
                "round scenarios and checks must match the frozen suite"
            )

    final_round = rounds[-1]
    failed_required = [
        scenario["scenario_id"]
        for scenario in final_round["scenarios"]
        if scenario["required"] and not all(scenario["checks"].values())
    ]
    if data["final_status"] == "passed":
        if failed_required or final_round["failed_items"]:
            raise ValidationError(
                "passed report contains failed required tests or failed_items"
            )
    elif data["final_status"] == "failed_after_3_rounds":
        if len(rounds) != 3:
            raise ValidationError(
                "failed_after_3_rounds requires exactly three rounds"
            )
        if not failed_required and not final_round["failed_items"]:
            raise ValidationError(
                "failed report must retain at least one failure"
            )
    else:
        raise ValidationError("invalid final_status")


def parse_frontmatter(skill_md: Path) -> dict[str, str]:
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValidationError("SKILL.md must start with YAML frontmatter")
    parts = text.split("---\n", 2)
    if len(parts) < 3:
        raise ValidationError("SKILL.md frontmatter is not closed")
    values: dict[str, str] = {}
    for line in parts[1].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return values


def validate_skill_dir(
    skill_dir: Path,
    expected_name: str | None = None,
    profile: str = "portable",
    frozen_spec_path: Path | None = None,
) -> str:
    skill_dir = normalized(skill_dir)
    skill_md = skill_dir / "SKILL.md"
    openai_yaml = skill_dir / "agents" / "openai.yaml"
    candidate_spec_path = skill_dir / "references" / "skill-spec.json"
    if not skill_md.is_file() or not candidate_spec_path.is_file():
        raise ValidationError(
            "candidate requires SKILL.md and references/skill-spec.json"
        )
    if profile not in {"portable", "openai"}:
        raise ValidationError("profile must be portable or openai")
    if profile == "openai" and not openai_yaml.is_file():
        raise ValidationError(
            "openai profile requires agents/openai.yaml"
        )
    frontmatter = parse_frontmatter(skill_md)
    require(frontmatter, ["name", "description"], "SKILL.md frontmatter")
    extra_frontmatter = sorted(set(frontmatter) - {"name", "description"})
    if extra_frontmatter:
        raise ValidationError(
            "SKILL.md frontmatter may only contain name and description: "
            + ", ".join(extra_frontmatter)
        )
    name = frontmatter["name"]
    required_name = expected_name if expected_name is not None else skill_dir.name
    if not SKILL_NAME_RE.fullmatch(name) or required_name != name:
        raise ValidationError(
            "candidate folder and frontmatter name must match leo- kebab-case"
        )

    text_files = [
        path
        for path in skill_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".md", ".yaml", ".yml"}
    ]
    combined = "\n".join(
        path.read_text(encoding="utf-8") for path in text_files
    )
    if "leo-lesson-to-skill" in combined:
        raise ValidationError(
            "generated skill must not reference leo-lesson-to-skill"
        )
    for marker in (
        "[COURSE_EVIDENCE]",
        "[DERIVED_TEMPLATE]",
        "[MODEL_OUTPUT]",
    ):
        if marker not in combined:
            raise ValidationError(
                f"generated skill missing layer marker: {marker}"
            )
    if openai_yaml.is_file() and f"${name}" not in openai_yaml.read_text(
        encoding="utf-8"
    ):
        raise ValidationError(
            "agents/openai.yaml default prompt must mention the generated skill"
        )
    candidate_spec = load_json(candidate_spec_path)
    validate_skill_spec_data(candidate_spec)
    if candidate_spec["skill_name"] != name:
        raise ValidationError(
            "candidate skill spec name does not match SKILL.md"
        )
    if frozen_spec_path is not None:
        frozen_spec = load_json(normalized(frozen_spec_path))
        validate_skill_spec_data(frozen_spec)
        if canonical_sha256(candidate_spec) != canonical_sha256(frozen_spec):
            raise ValidationError(
                "candidate skill spec does not match frozen skill spec"
            )
    skill_text = skill_md.read_text(encoding="utf-8")
    last_position = -1
    for step in candidate_spec["workflow"]:
        step_id = str(step["id"])
        position = skill_text.find(step_id)
        if position < 0:
            raise ValidationError(
                f"candidate SKILL.md missing workflow step ID: {step_id}"
            )
        if position <= last_position:
            raise ValidationError(
                "candidate SKILL.md workflow order does not match skill spec"
            )
        last_position = position
    for field in ("required_elements", "anti_patterns"):
        for item in candidate_spec[field]:
            if str(item) not in combined:
                raise ValidationError(
                    f"candidate missing {field} item from skill spec: {item}"
                )
    markdown_link_re = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    for path in [item for item in text_files if item.suffix.lower() == ".md"]:
        text = path.read_text(encoding="utf-8")
        for raw_target in markdown_link_re.findall(text):
            target = raw_target.strip().split("#", 1)[0]
            if (
                not target
                or "://" in target
                or target.startswith(("mailto:", "/"))
            ):
                continue
            if not normalized(path.parent / target).is_file():
                raise ValidationError(
                    f"broken relative link in {path}: {raw_target}"
                )
    return name


def command_init_run(args: argparse.Namespace) -> None:
    base = normalized(
        Path(args.temp_base) if args.temp_base else Path(tempfile.gettempdir())
    )
    parent = base / "leo-lesson-to-skill"
    parent.mkdir(parents=True, exist_ok=True)
    run_id = (
        f"RUN_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_"
        f"{uuid.uuid4().hex[:8].upper()}"
    )
    root = parent / run_id
    root.mkdir()
    if os.name == "nt":
        platform_name = "windows"
    elif sys.platform == "darwin":
        platform_name = "macos"
    else:
        platform_name = "linux"
    manifest = {
        "schema_version": "1.0",
        "run_id": run_id,
        "status": "initialized",
        "created_at": now_utc(),
        "updated_at": now_utc(),
        "platform": platform_name,
        "target_scenario": args.target_scenario,
        "source_inputs": args.source,
        "temp_root": str(root),
        "last_error": None,
        "environment": {
            "os": platform.platform(),
            "architecture": platform.machine(),
            "python": platform.python_version(),
        },
        "permanent_assets": [],
        "temporary_files": [],
    }
    write_json_atomic(root / "run_manifest.json", manifest)
    print(root / "run_manifest.json")


def command_validate_manifest(args: argparse.Namespace) -> None:
    validate_manifest_data(load_json(Path(args.file)))
    print("manifest: valid")


def command_validate_ir(args: argparse.Namespace) -> None:
    refs = validate_ir_data(load_json(Path(args.file)))
    print(f"IR: valid ({len(refs)} evidence refs)")


def command_validate_methodology(args: argparse.Namespace) -> None:
    refs = validate_ir_data(load_json(Path(args.ir))) if args.ir else None
    validate_methodology_data(load_json(Path(args.file)), refs)
    print("methodology: valid")


def command_validate_test_report(args: argparse.Namespace) -> None:
    validate_test_report_data(load_json(Path(args.file)))
    print("test report: valid")


def command_validate_skill_spec(args: argparse.Namespace) -> None:
    refs = (
        methodology_ids(load_json(Path(args.methodology)))
        if args.methodology
        else None
    )
    validate_skill_spec_data(load_json(Path(args.file)), refs)
    print("skill spec: valid")


def command_validate_skill(args: argparse.Namespace) -> None:
    name = validate_skill_dir(
        Path(args.dir),
        profile=args.profile,
        frozen_spec_path=Path(args.spec) if args.spec else None,
    )
    print(f"skill: valid ({name})")


def command_manifest_set_status(args: argparse.Namespace) -> None:
    manifest_path = normalized(Path(args.manifest))
    manifest = load_json(manifest_path)
    validate_manifest_data(manifest)
    if args.status not in RUN_STATES:
        raise ValidationError(f"invalid manifest status: {args.status}")
    current = manifest["status"]
    if args.status not in STATE_TRANSITIONS[current]:
        raise ValidationError(
            f"invalid status transition: {current} -> {args.status}"
        )
    manifest["status"] = args.status
    manifest["last_error"] = args.error
    manifest["updated_at"] = now_utc()
    write_json_atomic(manifest_path, manifest)
    print(f"manifest status: {args.status}")


def command_manifest_add_temp(args: argparse.Namespace) -> None:
    manifest_path = normalized(Path(args.manifest))
    manifest = load_json(manifest_path)
    validate_manifest_data(manifest)
    path = normalized(Path(args.path))
    root = normalized(Path(manifest["temp_root"]))
    if not is_within(path, root) or path == root:
        raise ValidationError("temporary file must be inside temp_root")
    if path.is_symlink() or has_reparse_point(path) or not path.is_file():
        raise ValidationError("temporary asset must be an existing regular file")
    existing = {
        normalized(Path(item["path"])) for item in manifest["temporary_files"]
    }
    if path not in existing:
        manifest["temporary_files"].append(
            {
                "path": str(path),
                "created_by_run": True,
                "size_bytes": path.stat().st_size,
                "status": "pending",
                "deleted_at": None,
                "error": None,
            }
        )
    manifest["updated_at"] = now_utc()
    write_json_atomic(manifest_path, manifest)
    print(f"temporary asset registered: {path}")


def command_manifest_add_permanent(args: argparse.Namespace) -> None:
    manifest_path = normalized(Path(args.manifest))
    manifest = load_json(manifest_path)
    validate_manifest_data(manifest)
    path = normalized(Path(args.path))
    if not path.exists():
        raise ValidationError("permanent asset must exist before registration")
    assets = {
        normalized(Path(value)) for value in manifest["permanent_assets"]
    }
    if path not in assets:
        manifest["permanent_assets"].append(str(path))
    manifest["updated_at"] = now_utc()
    write_json_atomic(manifest_path, manifest)
    print(f"permanent asset registered: {path}")


def command_publish(args: argparse.Namespace) -> None:
    candidate = normalized(Path(args.candidate))
    report = load_json(Path(args.test_report))
    validate_test_report_data(report)
    if report["final_status"] != "passed":
        raise ValidationError(
            "publication blocked: test report is not passed"
        )
    profile = getattr(args, "profile", "portable")
    spec_path = getattr(args, "spec", None)
    if not spec_path:
        raise ValidationError(
            "publication blocked: frozen skill spec is required"
        )
    frozen_spec = load_json(normalized(Path(spec_path)))
    validate_skill_spec_data(frozen_spec)
    frozen_spec_hash = canonical_sha256(frozen_spec)
    if report["skill_spec_hash"] != frozen_spec_hash:
        raise ValidationError(
            "publication blocked: test report skill_spec_hash does not match"
        )
    name = validate_skill_dir(
        candidate,
        profile=profile,
        frozen_spec_path=Path(spec_path),
    )
    if report["skill_name"] != name:
        raise ValidationError(
            "test report skill_name does not match candidate"
        )

    manifest_path = normalized(Path(args.manifest)) if args.manifest else None
    manifest = load_json(manifest_path) if manifest_path else None
    if manifest is not None:
        validate_manifest_data(manifest)
        if manifest["status"] != "passed":
            raise ValidationError(
                "publication blocked: manifest status must be passed"
            )

    destination_root = normalized(
        Path(args.destination_root)
        if args.destination_root
        else Path.home() / ".agents" / "skills"
    )
    destination_root.mkdir(parents=True, exist_ok=True)
    destination = destination_root / name
    partial = destination_root / f".{name}.{uuid.uuid4().hex}.partial"
    backup: Path | None = None
    if destination.exists():
        if not args.allow_overwrite:
            raise ValidationError(
                f"destination already exists: {destination}"
            )
        backup = destination_root / (
            f".{name}.backup.{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}"
            f".{uuid.uuid4().hex[:8]}"
        )
        os.replace(destination, backup)
    try:
        shutil.copytree(candidate, partial)
        validate_skill_dir(
            partial,
            expected_name=name,
            profile=profile,
            frozen_spec_path=Path(spec_path),
        )
        os.replace(partial, destination)
    except Exception:
        if partial.exists():
            shutil.rmtree(partial)
        if backup and backup.exists() and not destination.exists():
            os.replace(backup, destination)
        raise
    if manifest is not None and manifest_path is not None:
        for asset in (destination, backup):
            if asset is not None:
                value = str(normalized(asset))
                if value not in manifest["permanent_assets"]:
                    manifest["permanent_assets"].append(value)
        manifest["status"] = "published"
        manifest["last_error"] = None
        manifest["updated_at"] = now_utc()
        write_json_atomic(manifest_path, manifest)
    print(
        json.dumps(
            {
                "published": str(destination),
                "backup": str(backup) if backup else None,
            },
            ensure_ascii=False,
        )
    )


def cleanup_candidates(
    manifest: dict[str, Any],
) -> tuple[list[tuple[dict[str, Any], Path]], list[str]]:
    validate_manifest_data(manifest)
    root = normalized(Path(manifest["temp_root"]))
    permanent = {
        normalized(Path(value)) for value in manifest["permanent_assets"]
    }
    candidates: list[tuple[dict[str, Any], Path]] = []
    retained: list[str] = []
    for item in manifest["temporary_files"]:
        path = normalized(Path(item["path"]))
        reason = None
        if item["status"] == "deleted":
            reason = "already deleted"
        elif not item["created_by_run"]:
            reason = "not created by run"
        elif path in permanent:
            reason = "permanent asset"
        elif not is_within(path, root) or path == root:
            reason = "outside temp_root"
        elif path.is_symlink() or has_reparse_point(path):
            reason = "link or reparse point"
        elif not path.exists():
            reason = "missing"
        elif not path.is_file():
            reason = "not a regular file"
        if reason:
            retained.append(f"{path}: {reason}")
        else:
            candidates.append((item, path))
    return candidates, retained


def command_cleanup(args: argparse.Namespace) -> None:
    manifest_path = normalized(Path(args.manifest))
    manifest = load_json(manifest_path)
    validate_manifest_data(manifest)
    if manifest["status"] == "published":
        manifest["status"] = "cleanup_pending"
        manifest["updated_at"] = now_utc()
        write_json_atomic(manifest_path, manifest)
    elif manifest["status"] not in {"cleanup_pending", "cleanup_failed"}:
        raise ValidationError(
            "cleanup requires published, cleanup_pending, or cleanup_failed status"
        )
    candidates, retained = cleanup_candidates(manifest)
    total = sum(path.stat().st_size for _, path in candidates)
    if args.approve != "DELETE":
        print(
            json.dumps(
                {
                    "mode": "preview",
                    "files": [str(path) for _, path in candidates],
                    "total_bytes": total,
                    "retained": retained,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    failures = 0
    deleted = 0
    for item, path in candidates:
        try:
            path.unlink()
            deleted += 1
            item.update(
                status="deleted",
                deleted_at=now_utc(),
                error=None,
            )
        except OSError as exc:
            failures += 1
            item.update(status="failed", deleted_at=None, error=str(exc))
        manifest["updated_at"] = now_utc()
        write_json_atomic(manifest_path, manifest)

    for asset in manifest["permanent_assets"]:
        if not normalized(Path(asset)).exists():
            failures += 1
    manifest["status"] = "cleanup_failed" if failures else "cleaned"
    manifest["updated_at"] = now_utc()
    write_json_atomic(manifest_path, manifest)
    print(
        json.dumps(
            {
                "status": manifest["status"],
                "deleted": deleted,
                "failures": failures,
            },
            ensure_ascii=False,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init-run")
    init.add_argument("--source", action="append", required=True)
    init.add_argument("--target-scenario")
    init.add_argument("--temp-base")
    init.set_defaults(func=command_init_run)

    for name, function in (
        ("validate-manifest", command_validate_manifest),
        ("validate-ir", command_validate_ir),
        ("validate-test-report", command_validate_test_report),
    ):
        item = sub.add_parser(name)
        item.add_argument("--file", required=True)
        item.set_defaults(func=function)

    methodology = sub.add_parser("validate-methodology")
    methodology.add_argument("--file", required=True)
    methodology.add_argument("--ir")
    methodology.set_defaults(func=command_validate_methodology)

    skill_spec = sub.add_parser("validate-skill-spec")
    skill_spec.add_argument("--file", required=True)
    skill_spec.add_argument("--methodology")
    skill_spec.set_defaults(func=command_validate_skill_spec)

    skill = sub.add_parser("validate-skill")
    skill.add_argument("--dir", required=True)
    skill.add_argument(
        "--profile",
        choices=["portable", "openai"],
        default="portable",
    )
    skill.add_argument("--spec")
    skill.set_defaults(func=command_validate_skill)

    set_status = sub.add_parser("manifest-set-status")
    set_status.add_argument("--manifest", required=True)
    set_status.add_argument("--status", required=True)
    set_status.add_argument("--error")
    set_status.set_defaults(func=command_manifest_set_status)

    add_temp = sub.add_parser("manifest-add-temp")
    add_temp.add_argument("--manifest", required=True)
    add_temp.add_argument("--path", required=True)
    add_temp.set_defaults(func=command_manifest_add_temp)

    add_permanent = sub.add_parser("manifest-add-permanent")
    add_permanent.add_argument("--manifest", required=True)
    add_permanent.add_argument("--path", required=True)
    add_permanent.set_defaults(func=command_manifest_add_permanent)

    publish = sub.add_parser("publish")
    publish.add_argument("--candidate", required=True)
    publish.add_argument("--test-report", required=True)
    publish.add_argument("--destination-root")
    publish.add_argument("--manifest")
    publish.add_argument(
        "--profile",
        choices=["portable", "openai"],
        default="portable",
    )
    publish.add_argument("--spec")
    publish.add_argument("--allow-overwrite", action="store_true")
    publish.set_defaults(func=command_publish)

    cleanup = sub.add_parser("cleanup")
    cleanup.add_argument("--manifest", required=True)
    cleanup.add_argument("--approve")
    cleanup.set_defaults(func=command_cleanup)
    return parser


def main() -> int:
    try:
        args = build_parser().parse_args()
        args.func(args)
        return 0
    except ValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"ERROR: unexpected failure: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
