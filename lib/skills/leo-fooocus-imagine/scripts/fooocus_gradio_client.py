#!/usr/bin/env python3
"""Version-adaptive client for the original Fooocus Gradio server."""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from gradio_client import Client


def label_of(component: dict[str, Any]) -> str:
    props = component.get("props") or {}
    return f"{props.get('label') or ''} {props.get('elem_id') or ''}".strip().lower()


def semantic_id(components: dict[int, dict[str, Any]], input_ids: list[int], needles: list[str]) -> int | None:
    for component_id in input_ids:
        label = label_of(components.get(component_id, {}))
        if any(needle in label for needle in needles):
            return component_id
    return None


def discover_plan(config: dict[str, Any]) -> dict[str, Any]:
    components = {item["id"]: item for item in config.get("components", [])}
    dependencies = config.get("dependencies", [])
    prepare_candidates = []
    for index, dependency in enumerate(dependencies):
        outputs = dependency.get("outputs", [])
        inputs = dependency.get("inputs", [])
        if len(inputs) < 3 or not any(components.get(item, {}).get("type") == "state" for item in outputs):
            continue
        prompt_id = semantic_id(components, inputs, ["positive_prompt", "prompt"])
        model_id = semantic_id(components, inputs, ["base model"])
        prepare_candidates.append((len(inputs) + (1000 if prompt_id else 0) + (500 if model_id else 0), index, dependency))
    if not prepare_candidates:
        raise RuntimeError("Could not discover Fooocus task preparation API from /config")
    _, prepare_index, prepare = max(prepare_candidates)
    state_id = next(item for item in prepare["outputs"] if components[item].get("type") == "state")
    generation_candidates = []
    for index, dependency in enumerate(dependencies):
        if state_id not in dependency.get("inputs", []):
            continue
        output_types = [components.get(item, {}).get("type") for item in dependency.get("outputs", [])]
        if "gallery" in output_types and ("image" in output_types or "html" in output_types):
            generation_candidates.append((len(output_types), index, dependency))
    if not generation_candidates:
        raise RuntimeError("Could not discover Fooocus result generator API from /config")
    _, generation_index, generation = max(generation_candidates)
    input_ids = prepare["inputs"]
    semantics = {
        "prompt": semantic_id(components, input_ids, ["positive_prompt", "prompt"]),
        "negative": semantic_id(components, input_ids, ["negative prompt"]),
        "model": semantic_id(components, input_ids, ["base model"]),
        "refiner": semantic_id(components, input_ids, ["refiner (sdxl", "refiner model"]),
        "aspect_ratio": semantic_id(components, input_ids, ["aspect ratio"]),
        "count": semantic_id(components, input_ids, ["image number"]),
        "seed": semantic_id(components, input_ids, ["seed"]),
        "performance": semantic_id(components, input_ids, ["performance"]),
        "output_format": semantic_id(components, input_ids, ["output format"]),
        "input_enabled": semantic_id(components, input_ids, ["input image"]),
        "inpaint_prompt": semantic_id(components, input_ids, ["inpaint additional prompt"]),
        "outpaint": semantic_id(components, input_ids, ["outpaint direction"]),
        "styles": semantic_id(components, input_ids, ["selected styles"]),
    }
    return {
        "prepare_fn": prepare_index,
        "generate_fn": generation_index,
        "generation_outputs": generation.get("outputs", []),
        "input_ids": input_ids,
        "components": components,
        "semantics": semantics,
    }


def parse_ratio(value: str, choices: list[Any]) -> str:
    if not value or not choices:
        return value
    normalized = value.lower().replace("×", "*").replace("x", "*").replace(" ", "")
    for choice in choices:
        label = choice[0] if isinstance(choice, list) else choice
        text = str(label)
        plain = text.split("<", 1)[0].strip().lower().replace("×", "*").replace("x", "*").replace(" ", "")
        if normalized == plain or normalized in plain:
            return text
        if ":" in normalized and "∣" in text:
            if normalized in text.replace(" ", ""):
                return text
    return value


def image_component_ids(plan: dict[str, Any]) -> list[int]:
    components = plan["components"]
    return [item for item in plan["input_ids"] if components[item].get("type") == "image"]


def choose_image_slots(plan: dict[str, Any]) -> dict[str, int | None]:
    components = plan["components"]
    slots: dict[str, int | None] = {"uov": None, "inpaint": None, "mask": None, "image_prompt": None, "enhance": None}
    for item in image_component_ids(plan):
        label = label_of(components[item])
        if "mask upload" in label or "inpaint_mask_canvas" in label:
            slots["mask"] = item
        elif "inpaint_canvas" in label:
            slots["inpaint"] = item
        elif "use with enhance" in label:
            slots["enhance"] = item
        elif slots["uov"] is None:
            slots["uov"] = item
        elif slots["image_prompt"] is None:
            slots["image_prompt"] = item
    return slots


def newest_outputs(output_root: Path, started_at: float) -> list[Path]:
    if not output_root.exists():
        return []
    files = [item for item in output_root.rglob("*") if item.is_file() and item.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
    files = [item for item in files if item.stat().st_mtime >= started_at - 2]
    return sorted(files, key=lambda item: item.stat().st_mtime)


def output_root_from_cwd() -> Path:
    config_file = Path.cwd() / "config.txt"
    if config_file.exists():
        try:
            value = json.loads(config_file.read_text(encoding="utf-8")).get("path_outputs")
            if value:
                return Path(value)
        except Exception:
            pass
    return Path.cwd() / "outputs"


def copy_results(files: list[Path], output_dir: str | None) -> list[Path]:
    if not output_dir:
        return files
    destination = Path(output_dir).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    copied = []
    for source in files:
        target = destination / source.name
        if target.exists():
            target = destination / f"{source.stem}_{datetime.now().strftime('%H%M%S%f')}{source.suffix}"
        shutil.copy2(source, target)
        copied.append(target)
    return copied


def generate(args: argparse.Namespace) -> dict[str, Any]:
    url = args.url.rstrip("/")
    config_response = requests.get(f"{url}/config", timeout=15)
    config_response.raise_for_status()
    config = config_response.json()
    plan = discover_plan(config)
    components = plan["components"]
    semantics = plan["semantics"]
    overrides: dict[int, Any] = {}

    def put(name: str, value: Any) -> None:
        component_id = semantics.get(name)
        if component_id is not None and value is not None:
            overrides[component_id] = value

    put("prompt", args.prompt)
    put("negative", args.negative)
    put("model", args.model)
    put("refiner", args.refiner)
    put("count", args.count)
    selected_seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
    put("seed", str(selected_seed))
    put("performance", args.performance)
    put("output_format", args.output_format)
    if args.aspect_ratio and semantics.get("aspect_ratio") is not None:
        component = components[semantics["aspect_ratio"]]
        put("aspect_ratio", parse_ratio(args.aspect_ratio, component.get("props", {}).get("choices") or []))
    if args.styles and semantics.get("styles") is not None:
        put("styles", [item.strip() for item in args.styles.split(",") if item.strip()])

    mode = args.mode.lower()
    if mode != "text":
        put("input_enabled", True)
        slots = choose_image_slots(plan)
        input_file = Path(args.input).expanduser().resolve() if args.input else None
        mask_file = Path(args.mask).expanduser().resolve() if args.mask else None
        if input_file and not input_file.is_file():
            raise FileNotFoundError(f"Input image does not exist: {input_file}")
        if mask_file and not mask_file.is_file():
            raise FileNotFoundError(f"Mask image does not exist: {mask_file}")
        input_path = str(input_file) if input_file else None
        mask_path = str(mask_file) if mask_file else None
        if mode in {"vary", "upscale"}:
            if not input_path:
                raise ValueError(f"--input is required for {mode}")
            if slots["uov"] is None:
                raise RuntimeError("Could not discover Fooocus vary/upscale image input")
            overrides[slots["uov"]] = input_path
            for item in plan["input_ids"]:
                if "upscale or variation" in label_of(components[item]):
                    overrides[item] = args.uov_method or ("Vary (Subtle)" if mode == "vary" else "Upscale (2x)")
                    break
        elif mode in {"inpaint", "outpaint"}:
            if not input_path:
                raise ValueError(f"--input is required for {mode}")
            if slots["inpaint"] is None:
                raise RuntimeError("Could not discover Fooocus inpaint image input")
            overrides[slots["inpaint"]] = input_path
            if mode == "inpaint" and not mask_path:
                raise ValueError("--mask is required for inpaint")
            if mask_path:
                if slots["mask"] is None:
                    raise RuntimeError("Could not discover Fooocus inpaint mask input")
                overrides[slots["mask"]] = mask_path
            put("inpaint_prompt", args.inpaint_prompt or args.prompt)
            if mode == "outpaint":
                directions = [item.strip().title() for item in (args.outpaint or "Left,Right").split(",") if item.strip()]
                put("outpaint", directions)
        elif mode == "image-prompt":
            if not input_path:
                raise ValueError("--input is required for image-prompt")
            if slots["image_prompt"] is None:
                raise RuntimeError("Could not discover Fooocus image-prompt input")
            overrides[slots["image_prompt"]] = input_path
        else:
            raise ValueError(f"Unsupported mode: {args.mode}")

    call_args = []
    for component_id in plan["input_ids"]:
        component = components[component_id]
        if component.get("type") == "state":
            continue
        call_args.append(overrides.get(component_id, (component.get("props") or {}).get("value")))

    output_root = output_root_from_cwd()
    started_at = datetime.now().timestamp()
    client = Client(url, verbose=False)
    client.predict(*call_args, fn_index=plan["prepare_fn"])
    client.predict(fn_index=plan["generate_fn"])
    files = newest_outputs(output_root, started_at)
    if not files:
        raise RuntimeError(f"Fooocus completed but no new image appeared under {output_root}")
    files = copy_results(files, args.output_dir)
    return {
        "status": "success",
        "backend": "official-gradio",
        "capability": "text-to-image" if mode == "text" else mode,
        "seed": selected_seed,
        "prepare_fn": plan["prepare_fn"],
        "generate_fn": plan["generate_fn"],
        "images": [str(item.resolve()) for item in files],
        "metadata": {
            "prompt": args.prompt,
            "negative_prompt": args.negative,
            "model": args.model,
            "refiner": args.refiner,
            "styles": [item.strip() for item in args.styles.split(",") if item.strip()] if args.styles else None,
            "aspect_ratio": args.aspect_ratio,
            "source_image": str(Path(args.input).expanduser().resolve()) if args.input else None,
            "mask": str(Path(args.mask).expanduser().resolve()) if args.mask else None,
        },
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Version-adaptive original Fooocus Gradio client")
    sub = root.add_subparsers(dest="command", required=True)
    command = sub.add_parser("generate")
    command.add_argument("--url", default="http://127.0.0.1:7865")
    command.add_argument("--prompt", default="")
    command.add_argument("--negative")
    command.add_argument("--model")
    command.add_argument("--refiner")
    command.add_argument("--aspect-ratio")
    command.add_argument("--count", type=int, default=1)
    command.add_argument("--seed", type=int)
    command.add_argument("--performance")
    command.add_argument("--output-format")
    command.add_argument("--output-dir")
    command.add_argument("--styles")
    command.add_argument("--mode", default="text", choices=["text", "vary", "upscale", "inpaint", "outpaint", "image-prompt"])
    command.add_argument("--input")
    command.add_argument("--mask")
    command.add_argument("--inpaint-prompt")
    command.add_argument("--outpaint")
    command.add_argument("--uov-method")
    command.add_argument("--json", action="store_true")
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "generate":
            result = generate(args)
        else:
            raise ValueError(f"Unknown command: {args.command}")
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            for image in result.get("images", []):
                print(f"![Generated Image]({image})")
            print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
