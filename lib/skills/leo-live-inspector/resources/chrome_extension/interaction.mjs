import { lanternError } from "./errors.mjs";
import {
  findTargets,
  fingerprintElement,
  isDisabled,
  isVisible,
  resolveRef,
} from "./element-target.mjs";

function uniqueElement(document, registry, target) {
  let element;
  let matchLevel;
  if (target.kind === "ref") {
    const resolved = resolveRef(document, registry, target);
    element = resolved.element;
    matchLevel = resolved.matchLevel;
  } else {
    const matches = findTargets(document, registry, target);
    if (matches.length === 0) {
      const code = target.kind === "css" ? "selector_not_found" : "semantic_not_found";
      throw lanternError(code, `No matches for ${target.kind} target`);
    }
    if (matches.length > 1) {
      const code = target.kind === "css" ? "selector_ambiguous" : "semantic_ambiguous";
      throw lanternError(code, `${matches.length} matches for ${target.kind} target`);
    }
    element = matches[0];
    matchLevel = "located";
  }
  if (!isVisible(element) || isDisabled(element)) {
    throw lanternError("target_disabled", "Target is disabled or not actionable");
  }
  return { element, matchLevel };
}

function touchRef(document, registry, element, matchLevel) {
  const existing = registry.reverse.get(element);
  const ref = existing ?? registry.nextRef++;
  const record = {
    fingerprint: fingerprintElement(element, document),
    weak: WeakRef ? new WeakRef(element) : undefined,
  };
  registry.refs.delete(ref);
  while (registry.refs.size >= registry.capacity) {
    const oldestRef = registry.refs.keys().next().value;
    registry.refs.delete(oldestRef);
  }
  registry.refs.set(ref, record);
  registry.reverse.set(element, ref);
  return { ref, matchLevel };
}

function envelope(document, registry, element, target, action, matchLevel) {
  const identity = touchRef(document, registry, element, matchLevel);
  return {
    [action]: true,
    target,
    ref: identity.ref,
    generation: registry.generation,
    matches_n: 1,
    match_level: identity.matchLevel,
  };
}

export function clickTarget(document, registry, target) {
  const { element, matchLevel } = uniqueElement(document, registry, target);
  element.click();
  return envelope(document, registry, element, target, "clicked", matchLevel);
}

export function fillTarget(document, registry, target, value) {
  const { element, matchLevel } = uniqueElement(document, registry, target);
  const tag = element.tagName.toLowerCase();
  const editable = element.getAttribute?.("contenteditable") === "true";
  if (tag !== "input" && tag !== "textarea" && !editable) {
    throw lanternError("unsupported_target", "Fill supports input, textarea, and contenteditable");
  }
  const nextValue = String(value ?? "");
  element.focus?.();
  if (editable) element.textContent = nextValue;
  else element.value = nextValue;
  element.dispatchEvent?.({ type: "input", bubbles: true });
  element.dispatchEvent?.({ type: "change", bubbles: true });
  const actual = editable ? element.textContent : element.value;
  if (actual !== nextValue) {
    throw lanternError("fill_verification_failed", `Expected ${JSON.stringify(nextValue)}, got ${JSON.stringify(actual)}`);
  }
  return {
    ...envelope(document, registry, element, target, "filled", matchLevel),
    verified: true,
    actual,
  };
}
