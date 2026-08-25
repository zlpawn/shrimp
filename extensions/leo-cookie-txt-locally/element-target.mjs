import { lanternError } from "./errors.mjs";

const SEMANTIC_FIELDS = ["role", "name", "text", "label", "testId"];
const SEMANTIC_CANDIDATE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "select",
  "textarea",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[role]",
  "[aria-label]",
  "[aria-labelledby]",
  "[data-testid]",
].join(",");
const STATE_LIMIT = 200;

function invalidTarget(message) {
  return lanternError("invalid_target", message);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizeOptionalText(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized : undefined;
}

function caseAware(value, caseSensitive) {
  return caseSensitive ? String(value || "") : String(value || "").toLowerCase();
}

function matchesText(expected, actual, target) {
  const expectedText = caseAware(expected, target.caseSensitive);
  const actualText = caseAware(actual, target.caseSensitive);
  return target.match === "contains" ? actualText.includes(expectedText) : actualText === expectedText;
}

function isVisible(element) {
  for (let current = element; current; ) {
    if (current.hidden || current.getAttribute?.("hidden") != null) return false;
    if (current.getAttribute?.("aria-hidden") === "true") return false;
    const style = current.style || {};
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = current.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    current = current.parentNode;
  }
  return true;
}

function implicitRole(element) {
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return element.getAttribute("href") != null ? "link" : null;
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "summary") return "summary";
  if (/^h[1-6]$/.test(tag)) return `heading`;
  if (tag === "input") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    return "textbox";
  }
  return null;
}

function getRole(element) {
  return element.getAttribute?.("role") || implicitRole(element);
}

function descendantsText(element) {
  if (!element) return "";
  const own = typeof element.textContent === "string" ? element.textContent : "";
  return normalizeText(own);
}

function accessibleName(element, document) {
  const ariaLabel = element.getAttribute?.("aria-label");
  if (ariaLabel) return normalizeText(ariaLabel);
  const labelledBy = element.getAttribute?.("aria-labelledby");
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById?.(id))
      .filter(Boolean)
      .map(descendantsText);
    if (names.length) return normalizeText(names.join(" "));
  }
  const id = element.id;
  if (id) {
    const labels = Array.from(document.querySelectorAll?.("label") || []).filter(
      (label) => label.getAttribute("for") === id
    );
    if (labels.length) return normalizeText(labels.map(descendantsText).join(" "));
  }
  const wrappingLabel = closest?.(element, document, "label");
  if (wrappingLabel) return descendantsText(wrappingLabel);
  const alt = element.getAttribute?.("alt");
  if (alt) return normalizeText(alt);
  const value = element.value;
  if (typeof value === "string" && value) return normalizeText(value);
  return descendantsText(element);
}

function closest(element, document, selector) {
  if (typeof element.closest === "function") return element.closest(selector);
  for (let current = element?.parentNode; current; current = current.parentNode) {
    if (current.tagName && current.tagName.toLowerCase() === selector) return current;
  }
  return null;
}

function semanticCandidates(document) {
  if (typeof document.querySelectorAll !== "function") return [];
  const all = Array.from(document.querySelectorAll("*"));
  const tags = new Set(["button", "a", "input", "select", "textarea", "summary", "h1", "h2", "h3", "h4", "h5", "h6"]);
  return all.filter((element) => {
    const tag = element.tagName.toLowerCase();
    return tags.has(tag) || ["role", "aria-label", "aria-labelledby", "data-testid"].some((name) => element.getAttribute?.(name) != null);
  });
}

function isDisabled(element) {
  return Boolean(element.disabled || element.getAttribute?.("aria-disabled") === "true");
}

function touchRegistry(registry, ref, fingerprint, element) {
  registry.refs.delete(ref);
  if (registry.reverse.get(element) === ref) registry.reverse.delete(element);
  while (registry.refs.size >= registry.capacity) {
    const oldestRef = registry.refs.keys().next().value;
    const oldest = registry.refs.get(oldestRef);
    const oldestNode = oldest.weak?.deref?.() || oldest.node;
    if (oldestNode && registry.reverse.get(oldestNode) === oldestRef) registry.reverse.delete(oldestNode);
    registry.refs.delete(oldestRef);
  }
  const record = { fingerprint, ...(WeakRef ? { weak: new WeakRef(element) } : { node: element }) };
  registry.refs.set(ref, record);
  registry.reverse.set(element, ref);
  return ref;
}

export function ensureDocumentRegistry(globalObject = globalThis, options = {}) {
  const key = "__leoLanternTargets";
  if (!globalObject[key]) {
    globalObject[key] = {
      generation: options.generation || crypto.randomUUID(),
      nextRef: 1,
      capacity: options.capacity || 1000,
      refs: new Map(),
      reverse: new WeakMap(),
    };
  }
  return globalObject[key];
}

function refFor(registry, element, fingerprintFactory) {
  const existing = registry.reverse.get(element);
  if (existing != null && registry.refs.has(existing)) {
    touchRegistry(registry, existing, fingerprintFactory(element), element);
    return existing;
  }
  const ref = registry.nextRef++;
  return touchRegistry(registry, ref, fingerprintFactory(element), element);
}

export function collectState(document, registry) {
  const candidates = semanticCandidates(document).filter(isVisible).slice(0, STATE_LIMIT);
  const elements = candidates.map((element) => {
    const ref = refFor(registry, element, () => semanticValues(element, document));
    const values = semanticValues(element, document);
    return {
      ref,
      tag: element.tagName.toLowerCase(),
      role: values.role || undefined,
      name: values.name || undefined,
      text: values.text || undefined,
      visible: true,
      disabled: isDisabled(element),
    };
  });
  return {
    url: document.URL,
    title: document.title,
    generation: registry.generation,
    elements,
  };
}

function associatedLabelText(element, document) {
  const id = element.id;
  if (id) {
    const labels = Array.from(document.querySelectorAll?.("label") || []).filter(
      (label) => label.getAttribute("for") === id
    );
    if (labels.length) return normalizeText(labels.map(descendantsText).join(" "));
  }
  const wrapper = closest(element, document, "label");
  return wrapper ? descendantsText(wrapper) : "";
}

function semanticValues(element, document) {
  return {
    role: normalizeText(getRole(element) || ""),
    name: accessibleName(element, document),
    text: descendantsText(element),
    label: associatedLabelText(element, document),
    testId: normalizeText(element.getAttribute?.("data-testid") || ""),
  };
}

export function findTargets(document, registry, target) {
  if (target.kind === "css") {
    try {
      return Array.from(document.querySelectorAll(target.selector));
    } catch {
      throw lanternError("invalid_selector", `Invalid CSS selector: ${target.selector}`);
    }
  }
  if (target.kind !== "semantic") return [];

  const candidates = semanticCandidates(document);
  return candidates.filter((element) => {
    if (!isVisible(element)) return false;
    const values = semanticValues(element, document);
    return SEMANTIC_FIELDS.every((field) => {
      if (target[field] === undefined) return true;
      if (field === "role" || field === "testId") return values[field] === target[field];
      return matchesText(target[field], values[field], target);
    });
  });
}

export function normalizeTarget(params = {}) {
  const target = params.target ?? null;
  const legacySelector = params.selector !== undefined ? params.selector : null;
  const legacyText = params.text !== undefined ? params.text : null;
  const legacyFormCount = Number(legacySelector !== null) + Number(legacyText !== null);

  if (target !== null) {
    if (legacyFormCount || typeof target !== "object" || Array.isArray(target)) {
      throw invalidTarget("Exactly one target form is required");
    }
    return normalizeTargetObject(target);
  }

  if (legacyFormCount === 1) {
    if (legacySelector !== null) {
      return normalizeTargetObject({ kind: "css", selector: legacySelector });
    }
    return normalizeTargetObject({ kind: "semantic", text: legacyText, match: "contains" });
  }
  if (legacyFormCount > 1) throw invalidTarget("Exactly one target form is required");
  throw invalidTarget("A target is required");
}

function normalizeTargetObject(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw invalidTarget("Target must be an object");
  }
  if (target.kind === "ref") return normalizeRefTarget(target);
  if (target.kind === "css") return normalizeCssTarget(target);
  if (target.kind === "semantic") return normalizeSemanticTarget(target);
  throw invalidTarget("Unsupported target kind");
}

function ensureOnlyFields(target, allowed) {
  for (const key of Object.keys(target)) {
    if (!allowed.includes(key)) throw invalidTarget(`Unexpected target field: ${key}`);
  }
}

function normalizeRefTarget(target) {
  ensureOnlyFields(target, ["kind", "ref", "generation"]);
  const ref = Number(target.ref);
  const generation = normalizeText(target.generation);
  if (!Number.isInteger(ref) || ref <= 0 || Number(target.ref) !== ref) {
    throw invalidTarget("Target ref must be a positive integer");
  }
  if (!generation) throw invalidTarget("Target ref requires a document generation");
  return { kind: "ref", ref, generation };
}

function normalizeCssTarget(target) {
  ensureOnlyFields(target, ["kind", "selector"]);
  const selector = String(target.selector ?? "").trim();
  if (!selector) throw invalidTarget("CSS target requires a selector");
  return { kind: "css", selector };
}

function normalizeSemanticTarget(target) {
  ensureOnlyFields(target, ["kind", ...SEMANTIC_FIELDS, "match", "caseSensitive"]);
  const normalized = { kind: "semantic" };
  let fieldCount = 0;
  for (const field of SEMANTIC_FIELDS) {
    const value = normalizeOptionalText(target[field]);
    if (value !== undefined) {
      normalized[field] = value;
      fieldCount += 1;
    }
  }
  if (!fieldCount) throw invalidTarget("Semantic target requires at least one locator field");

  const match = target.match === undefined ? "exact" : target.match;
  if (match !== "exact" && match !== "contains") {
    throw invalidTarget("Semantic match must be exact or contains");
  }
  normalized.match = match;
  normalized.caseSensitive = target.caseSensitive === undefined ? false : target.caseSensitive === true;
  return normalized;
}
