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
      throw lanternError(code, `${matches.length} matches for ${target.kind} target`, {
        reason: "ambiguous_match",
        matches_n: matches.length,
        clicked: false,
      });
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

export function clickTarget(document, registry, target, { deferClick = false } = {}) {
  const { element: rawElement, matchLevel } = uniqueElement(document, registry, target);
  let element = rawElement;
  if (element.classList?.contains?.("ant-select")) {
    const selectorChild = element.querySelector?.(".ant-select-selector, input[role='combobox'], .ant-select-selection-search input");
    if (selectorChild) {
      element = selectorChild;
    }
  }
  element.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
  if (!deferClick) {
    element.click();
  }
  return envelope(document, registry, element, target, "clicked", matchLevel);
}

export function fillTarget(document, registry, target, value, { deferFill = false, blur = false } = {}) {
  const { element, matchLevel } = uniqueElement(document, registry, target);
  const tag = element.tagName.toLowerCase();
  const editable = element.getAttribute?.("contenteditable") === "true";
  if (tag !== "input" && tag !== "textarea" && !editable) {
    throw lanternError("unsupported_target", "Fill supports input, textarea, and contenteditable");
  }
  const nextValue = String(value ?? "");
  element.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
  element.focus?.();

  if (deferFill) {
    if (tag === "input" || tag === "textarea") {
      try {
        if (typeof element.select === "function") {
          element.select();
        } else if (typeof element.setSelectionRange === "function") {
          element.setSelectionRange(0, element.value?.length || 0);
        }
      } catch {}
    } else if (editable) {
      try {
        const range = document.createRange?.();
        if (range) {
          range.selectNodeContents(element);
          const sel = globalThis.getSelection?.();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      } catch {}
    }
    return {
      ...envelope(document, registry, element, target, "filled", matchLevel),
      deferred: true,
      expected: nextValue,
    };
  }

  if (editable) {
    element.textContent = nextValue;
  } else {
    try {
      const proto = tag === "textarea" ? globalThis.HTMLTextAreaElement?.prototype : globalThis.HTMLInputElement?.prototype;
      const set = proto && Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (set) {
        set.call(element, nextValue);
      } else {
        element.value = nextValue;
      }
    } catch {
      element.value = nextValue;
    }
  }

  // Break React _valueTracker cache if present
  try {
    if (element._valueTracker && typeof element._valueTracker.setValue === "function") {
      element._valueTracker.setValue("");
    }
  } catch {}

  // Dispatch InputEvent with inputType: 'insertText' (modern React & UI libraries)
  try {
    const InputEventCtor = typeof InputEvent === "function" ? InputEvent : null;
    if (InputEventCtor) {
      element.dispatchEvent(new InputEventCtor("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: nextValue }));
      element.dispatchEvent(new InputEventCtor("input", { bubbles: true, inputType: "insertText", data: nextValue }));
    } else {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch {
    try {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {
      element.dispatchEvent?.({ type: "input", bubbles: true });
    }
  }

  try {
    element.dispatchEvent?.(typeof Event === "function" ? new Event("change", { bubbles: true }) : { type: "change", bubbles: true });
  } catch {
    element.dispatchEvent?.({ type: "change", bubbles: true });
  }

  if (blur) {
    try {
      element.dispatchEvent?.(typeof Event === "function" ? new Event("blur", { bubbles: true }) : { type: "blur", bubbles: true });
      element.blur?.();
    } catch {}
  }

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
