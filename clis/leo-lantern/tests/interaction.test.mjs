import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureDocumentRegistry,
  fingerprintElement,
  normalizeTarget,
} from "../../../extensions/leo-cookie-txt-locally/element-target.mjs";
import { clickTarget, fillTarget } from "../../../extensions/leo-cookie-txt-locally/interaction.mjs";

class FakeElement {
  constructor(tag, attributes = {}) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.parentNode = { getBoundingClientRect: () => ({ width: 100, height: 30 }), getAttribute: () => null };
    this.isConnected = true;
    this.disabled = false;
    this.events = [];
    this.value = "";
  }

  get id() {
    return this.attributes.get("id") || "";
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30 };
  }

  click() {
    this.events.push("click");
  }

  focus() {
    this.events.push("focus");
  }

  dispatchEvent(event) {
    this.events.push(event.type);
  }
}

function documentWith(elements) {
  return {
    querySelectorAll(selector) {
      if (selector === "*") return elements;
      if (selector === "label") return [];
      const tag = selector.split(/[.[]/, 1)[0];
      if (tag) return elements.filter((element) => element.tagName === tag.toUpperCase());
      throw new Error(`No selector ${selector}`);
    },
    createElement() {
      return { dispatchEvent(event) { elements.events?.push(event.type); } };
    },
  };
}

function registryWith(document, element) {
  const registry = ensureDocumentRegistry({}, { generation: "gen-1" });
  const ref = 1;
  registry.refs.set(ref, {
    fingerprint: fingerprintElement(element, document),
    weak: new WeakRef(element),
  });
  registry.reverse.set(element, ref);
  registry.nextRef = 2;
  return { registry, ref };
}

test("click resolves CSS targets, dispatches the action, and returns a stable envelope", () => {
  const element = new FakeElement("button", { id: "login", "data-testid": "login" });
  element.textContent = "Log in";
  const document = documentWith([element]);
  const { registry } = registryWith(document, element);
  const target = normalizeTarget({ target: { kind: "css", selector: "button" } });

  const result = clickTarget(document, registry, target);
  assert.deepEqual(result, {
    clicked: true,
    target,
    ref: 1,
    generation: "gen-1",
    matches_n: 1,
    match_level: "located",
  });
  assert.deepEqual(element.events, ["click"]);
});

test("click resolves refs exact and rejects ambiguous, hidden, or disabled targets without acting", () => {
  const element = new FakeElement("button", { id: "login" });
  element.textContent = "Log in";
  const document = documentWith([element]);
  const { registry, ref } = registryWith(document, element);
  const refTarget = normalizeTarget({ target: { kind: "ref", ref, generation: "gen-1" } });
  assert.equal(clickTarget(document, registry, refTarget).match_level, "exact");

  const first = new FakeElement("button", {});
  const second = new FakeElement("button", {});
  first.textContent = "Go";
  second.textContent = "Go";
  const ambiguousDocument = documentWith([first, second]);
  assert.throws(
    () => clickTarget(ambiguousDocument, ensureDocumentRegistry({}, { generation: "x" }), normalizeTarget({ selector: "button" })),
    (err) => err.code === "selector_ambiguous"
  );

  element.disabled = true;
  assert.throws(
    () => clickTarget(document, registry, refTarget),
    (err) => err.code === "target_disabled"
  );
  assert.deepEqual(element.events, ["click"]);
});

test("fill updates and verifies inputs textareas and contenteditable", () => {
  const input = new FakeElement("input", { id: "search" });
  const inputDocument = documentWith([input]);
  const inputRegistry = registryWith(inputDocument, input).registry;
  const filled = fillTarget(
    inputDocument,
    inputRegistry,
    normalizeTarget({ selector: "input" }),
    "new value"
  );
  assert.equal(filled.filled, true);
  assert.equal(filled.verified, true);
  assert.equal(filled.actual, "new value");
  assert.equal(input.value, "new value");

  const editable = new FakeElement("div", { contenteditable: "true", id: "note" });
  editable.textContent = "";
  const editableDocument = documentWith([editable]);
  const editableRegistry = registryWith(editableDocument, editable).registry;
  const editableResult = fillTarget(
    editableDocument,
    editableRegistry,
    normalizeTarget({ selector: "div" }),
    "typed text"
  );
  assert.equal(editableResult.verified, true);
  assert.equal(editable.textContent, "typed text");

  const unsupported = new FakeElement("button");
  const unsupportedDocument = documentWith([unsupported]);
  const unsupportedRegistry = registryWith(unsupportedDocument, unsupported).registry;
  assert.throws(
    () => fillTarget(unsupportedDocument, unsupportedRegistry, normalizeTarget({ selector: "button" }), "x"),
    (err) => err.code === "unsupported_target"
  );
});
