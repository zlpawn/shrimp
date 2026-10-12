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

def label_of(component: dict[str, Any]) -> str:
    props = component.get("props") or {}
    return f"{props.get('label') or ''} {props.get('elem_id') or ''}".strip().lower()


def semantic_id(components: dict[int, dict[str, Any]], input_ids: list[int], needles: list[str]) -> int | None:
    for component_id in input_ids:
        label = label_of(components.get(component_id, {}))
        if any(needle in label for needle in needles):
            return component_id
    return None


def component_choices(component: dict[str, Any]) -> list[Any]:
    choices = (component.get("props") or {}).get("choices") or []
    return [item[1] if isinstance(item, list) and len(item) > 1 else item[0] if isinstance(item, list) else item for item in choices]


def discover_lora_slots(components: dict[int, dict[str, Any]], input_ids: list[int]) -> list[dict[str, int]]:
    slots = []
    for index, component_id in enumerate(input_ids):
        component = components.get(component_id, {})
        label = label_of(component)
        if component.get("type") != "dropdown" or not label.startswith("lora "):
            continue
        before = input_ids[index - 1] if index > 0 else None
        after = input_ids[index + 1] if index + 1 < len(input_ids) else None
        if before is None or after is None:
            continue
        if components.get(before, {}).get("type") == "checkbox" and "weight" in label_of(components.get(after, {})):
            slots.append({"enabled": before, "model": component_id, "weight": after})
    return slots


def discover_control_slots(components: dict[int, dict[str, Any]], input_ids: list[int]) -> list[dict[str, int]]:
    slots = []
    for index, component_id in enumerate(input_ids):
        component = components.get(component_id, {})
        choices = {str(item).lower() for item in component_choices(component)}
        if component.get("type") != "radio" or not {"imageprompt", "pyracanny", "cpds", "faceswap"}.issubset(choices):
            continue
        preceding = input_ids[max(0, index - 3):index]
        if len(preceding) != 3:
            continue
        image_id, stop_id, weight_id = preceding
        if components.get(image_id, {}).get("type") == "image" and "stop at" in label_of(components.get(stop_id, {})) and "weight" in label_of(components.get(weight_id, {})):
            slots.append({"image": image_id, "stop_at": stop_id, "weight": weight_id, "type": component_id})
    return slots


def discover_enhance(components: dict[int, dict[str, Any]], input_ids: list[int]) -> dict[str, int | None]:
    image_id = semantic_id(components, input_ids, ["use with enhance"])
    master_id = next((
        item for item in input_ids
        if components.get(item, {}).get("type") == "checkbox" and label_of(components.get(item, {})) == "enhance"
    ), None)
    enabled_ids = [item for item in input_ids if components.get(item, {}).get("type") == "checkbox" and label_of(components.get(item, {})) == "enable"]
    first_enabled = next((item for item in enabled_ids if image_id is not None and input_ids.index(item) > input_ids.index(image_id)), None)
    search_ids = input_ids[input_ids.index(first_enabled):] if first_enabled is not None else []
    return {
        "master_enabled": master_id,
        "input": image_id,
        "enabled": first_enabled,
        "detection_prompt": semantic_id(components, search_ids, ["detection prompt"]),
        "positive_prompt": semantic_id(components, search_ids, ["enhancement positive prompt"]),
        "negative_prompt": semantic_id(components, search_ids, ["enhancement negative prompt"]),
        "mask_model": semantic_id(components, search_ids, ["mask generation model"]),
        "sam_model": semantic_id(components, search_ids, ["sam model"]),
        "box_threshold": semantic_id(components, search_ids, ["box threshold"]),
        "text_threshold": semantic_id(components, search_ids, ["text threshold"]),
        "max_detections": semantic_id(components, search_ids, ["maximum number of detections"]),
    }


def discover_describe_plan(config: dict[str, Any]) -> dict[str, Any]:
    components = {item["id"]: item for item in config.get("components", [])}
    for index, dependency in enumerate(config.get("dependencies", [])):
        inputs = dependency.get("inputs", [])
        outputs = dependency.get("outputs", [])
        methods = semantic_id(components, inputs, ["content type"])
        image = next((item for item in inputs if components.get(item, {}).get("type") == "image"), None)
        apply_styles = semantic_id(components, inputs, ["apply styles"])
        prompt_output = semantic_id(components, outputs, ["positive_prompt", "prompt"])
        styles_output = semantic_id(components, outputs, ["selected styles"])
        if dependency.get("trigger") == "click" and None not in (methods, image, apply_styles, prompt_output, styles_output):
            return {
                "fn": index,
                "methods": methods,
                "image": image,
                "apply_styles": apply_styles,
                "prompt_output": prompt_output,
                "styles_output": styles_output,
            }
    raise RuntimeError("Could not discover Fooocus describe API from /config")


def parse_lora_specs(values: list[str] | None) -> list[tuple[str, float]]:
    result = []
    for value in values or []:
        parts = value.rsplit("|", 1)
        model = parts[0].strip()
        if not model:
            raise ValueError("LoRA model filename cannot be empty")
        result.append((model, float(parts[1]) if len(parts) == 2 and parts[1].strip() else 1.0))
    return result


def parse_control_specs(values: list[str] | None) -> list[tuple[str, str, float, float]]:
    result = []
    for value in values or []:
        parts = value.rsplit("|", 3)
        if len(parts) < 2:
            raise ValueError("Control specification must be IMAGE|TYPE[|STOP_AT|WEIGHT]")
        image = Path(parts[0]).expanduser().resolve()
        control_type = parts[1].strip()
        stop_at = float(parts[2]) if len(parts) >= 3 and parts[2].strip() else 0.5
        weight = float(parts[3]) if len(parts) >= 4 and parts[3].strip() else 0.6
        result.append((str(image), control_type, stop_at, weight))
    return result


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
        "lora_slots": discover_lora_slots(components, input_ids),
        "control_slots": discover_control_slots(components, input_ids),
        "enhance": discover_enhance(components, input_ids),
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


def validated_image_path(value: str | None, label: str) -> str:
    if not value:
        raise ValueError(f"{label} is required")
    image = Path(value).expanduser().resolve()
    if not image.is_file():
        raise FileNotFoundError(f"{label} does not exist: {image}")
    return str(image)


def apply_loras(plan: dict[str, Any], overrides: dict[int, Any], values: list[str] | None) -> list[tuple[str, float]]:
    specs = parse_lora_specs(values)
    slots = plan.get("lora_slots", [])
    if len(specs) > len(slots):
        raise ValueError(f"Fooocus exposes {len(slots)} LoRA slots, but {len(specs)} were requested")
    for slot, (model, weight) in zip(slots, specs):
        choices = [str(item) for item in component_choices(plan["components"][slot["model"]])]
        if choices and model not in choices:
            raise ValueError(f"LoRA is not available in Fooocus: {model}")
        overrides[slot["enabled"]] = True
        overrides[slot["model"]] = model
        overrides[slot["weight"]] = weight
    return specs


def apply_controls(plan: dict[str, Any], overrides: dict[int, Any], values: list[str] | None) -> list[tuple[str, str, float, float]]:
    specs = parse_control_specs(values)
    slots = plan.get("control_slots", [])
    if len(specs) > len(slots):
        raise ValueError(f"Fooocus exposes {len(slots)} control slots, but {len(specs)} were requested")
    for slot, (image, control_type, stop_at, weight) in zip(slots, specs):
        if not Path(image).is_file():
            raise FileNotFoundError(f"Control image does not exist: {image}")
        choices = [str(item) for item in component_choices(plan["components"][slot["type"]])]
        matched = next((item for item in choices if item.lower() == control_type.lower()), None)
        if matched is None:
            raise ValueError(f"Unsupported Fooocus control type: {control_type}; choices: {', '.join(choices)}")
        overrides[slot["image"]] = image
        overrides[slot["stop_at"]] = stop_at
        overrides[slot["weight"]] = weight
        overrides[slot["type"]] = matched
    if specs and plan.get("semantics", {}).get("input_enabled") is not None:
        overrides[plan["semantics"]["input_enabled"]] = True
    return specs


def generate(args: argparse.Namespace) -> dict[str, Any]:
    import requests
    from gradio_client import Client

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
    loras = apply_loras(plan, overrides, args.lora)
    controls = apply_controls(plan, overrides, args.control)

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
            "loras": [{"model": model, "weight": weight} for model, weight in loras],
            "controls": [
                {"image": image, "type": control_type, "stop_at": stop_at, "weight": weight}
                for image, control_type, stop_at, weight in controls
            ],
        },
    }


def describe(args: argparse.Namespace) -> dict[str, Any]:
    import requests
    from gradio_client import Client

    url = args.url.rstrip("/")
    config_response = requests.get(f"{url}/config", timeout=15)
    config_response.raise_for_status()
    plan = discover_describe_plan(config_response.json())
    image = validated_image_path(args.input, "Input image")
    methods = [item.strip() for item in args.content_type.split(",") if item.strip()]
    result = Client(url, verbose=False).predict(methods, image, args.apply_styles, fn_index=plan["fn"])
    if not isinstance(result, (list, tuple)) or len(result) < 2:
        raise RuntimeError("Fooocus describe returned an unexpected result")
    return {
        "status": "success",
        "backend": "official-gradio",
        "capability": "describe",
        "description": result[0],
        "styles": result[1] if isinstance(result[1], list) else [],
        "metadata": {"source_image": image, "content_types": methods},
    }


def enhance(args: argparse.Namespace) -> dict[str, Any]:
    import requests
    from gradio_client import Client

    url = args.url.rstrip("/")
    config_response = requests.get(f"{url}/config", timeout=15)
    config_response.raise_for_status()
    plan = discover_plan(config_response.json())
    components = plan["components"]
    semantics = plan["semantics"]
    enhance_plan = plan.get("enhance", {})
    source_image = validated_image_path(args.input, "Input image")
    if enhance_plan.get("input") is None or enhance_plan.get("enabled") is None:
        raise RuntimeError("Could not discover Fooocus Enhance inputs")
    overrides: dict[int, Any] = {
        enhance_plan["input"]: source_image,
        enhance_plan["enabled"]: True,
    }
    if enhance_plan.get("master_enabled") is not None:
        overrides[enhance_plan["master_enabled"]] = True
    values = {
        "prompt": args.prompt,
        "negative": args.negative,
        "model": args.model,
        "refiner": args.refiner,
        "performance": args.performance,
    }
    for name, value in values.items():
        component_id = semantics.get(name)
        if component_id is not None and value is not None:
            overrides[component_id] = value
    selected_seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
    if semantics.get("seed") is not None:
        overrides[semantics["seed"]] = str(selected_seed)
    enhance_values = {
        "detection_prompt": args.detection_prompt,
        "positive_prompt": args.prompt,
        "negative_prompt": args.negative,
        "mask_model": args.mask_model,
        "sam_model": args.sam_model,
        "box_threshold": args.box_threshold,
        "text_threshold": args.text_threshold,
        "max_detections": args.max_detections,
    }
    for name, value in enhance_values.items():
        component_id = enhance_plan.get(name)
        if component_id is not None and value is not None:
            overrides[component_id] = value
    loras = apply_loras(plan, overrides, args.lora)
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
        raise RuntimeError(f"Fooocus Enhance completed but no new image appeared under {output_root}")
    files = copy_results(files, args.output_dir)
    return {
        "status": "success",
        "backend": "official-gradio",
        "capability": "enhance",
        "seed": selected_seed,
        "images": [str(item.resolve()) for item in files],
        "metadata": {
            "source_image": source_image,
            "detection_prompt": args.detection_prompt,
            "loras": [{"model": model, "weight": weight} for model, weight in loras],
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
    command.add_argument("--lora", action="append", default=[])
    command.add_argument("--control", action="append", default=[])
    command.add_argument("--json", action="store_true")
    describe_command = sub.add_parser("describe")
    describe_command.add_argument("--url", default="http://127.0.0.1:7865")
    describe_command.add_argument("--input", required=True)
    describe_command.add_argument("--content-type", default="Photograph")
    describe_command.add_argument("--no-apply-styles", dest="apply_styles", action="store_false")
    describe_command.set_defaults(apply_styles=True)
    describe_command.add_argument("--json", action="store_true")
    enhance_command = sub.add_parser("enhance")
    enhance_command.add_argument("--url", default="http://127.0.0.1:7865")
    enhance_command.add_argument("--input", required=True)
    enhance_command.add_argument("--prompt", default="")
    enhance_command.add_argument("--negative")
    enhance_command.add_argument("--detection-prompt", default="face")
    enhance_command.add_argument("--mask-model", default="sam")
    enhance_command.add_argument("--sam-model", default="vit_b")
    enhance_command.add_argument("--box-threshold", type=float)
    enhance_command.add_argument("--text-threshold", type=float)
    enhance_command.add_argument("--max-detections", type=int)
    enhance_command.add_argument("--model")
    enhance_command.add_argument("--refiner")
    enhance_command.add_argument("--performance")
    enhance_command.add_argument("--seed", type=int)
    enhance_command.add_argument("--lora", action="append", default=[])
    enhance_command.add_argument("--output-dir")
    enhance_command.add_argument("--json", action="store_true")
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "generate":
            result = generate(args)
        elif args.command == "describe":
            result = describe(args)
        elif args.command == "enhance":
            result = enhance(args)
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
