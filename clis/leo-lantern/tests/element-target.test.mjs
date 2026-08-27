import test from "node:test";
import assert from "node:assert/strict";
import {
  collectState,
  ensureDocumentRegistry,
  findTargets,
  fingerprintElement,
  findTargetSnapshot,
  normalizeTarget,
  resolveRef,
} from "../../../extensions/leo-cookie-txt-locally/element-target.mjs";

class FakeElement {
  constructor(tag, attributes = {}, children = []) {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = children;
    this.parentNode = null;
    this.isConnected = true;
    this.disabled = false;
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

  get href() {
    return this.attributes.get("href") || "";
  }
}

function fixtureDocument(elements) {
  const body = new FakeElement("body", {}, elements);
  for (const element of elements) element.parentNode = body;
  return {
    title: "Example",
    URL: "https://example.com/page",
    body,
    selectors: new Set(),
    querySelectorAll(selector) {
      if (this.selectors.has(selector)) throw new Error("invalid selector");
      if (selector === "*") return [body, ...elements];
      if (selector === "label") return elements.filter((element) => element.tagName === "LABEL");
      const tag = selector.split(/[.[]/, 1)[0];
      const isAttributeSelector = tag.startsWith("[");
      if (isAttributeSelector) {
        return elements.filter((element) =>
          ["role", "aria-label", "aria-labelledby", "data-testid"].some(
            (name) => element.getAttribute(name) != null
          )
        );
      }
      return elements.filter(
        (element) =>
          element.parentNode === body &&
          element.tagName === tag.toUpperCase()
      );
    },
  };
}

test("target schema accepts one normalized ref form", () => {
  assert.deepEqual(normalizeTarget({ target: { kind: "ref", ref: "12", generation: "gen-1" } }), {
    kind: "ref",
    ref: 12,
    generation: "gen-1",
  });
});

test("ref targets require a positive integer and generation", () => {
  assert.throws(
    () => normalizeTarget({ target: { kind: "ref", ref: 1.5, generation: "gen-1" } }),
    (err) => err.code === "invalid_target"
  );
  assert.throws(
    () => normalizeTarget({ target: { kind: "ref", ref: 12 } }),
    (err) => err.code === "invalid_target"
  );
});

test("CSS targets require a selector", () => {
  assert.deepEqual(normalizeTarget({ target: { kind: "css", selector: "button.primary" } }), {
    kind: "css",
    selector: "button.primary",
  });
  assert.throws(
    () => normalizeTarget({ target: { kind: "css", selector: "" } }),
    (err) => err.code === "invalid_target"
  );
});

test("semantic targets combine fields and default text matching to exact", () => {
  assert.deepEqual(
    normalizeTarget({
      target: { kind: "semantic", role: "button", text: " Sign   In ", caseSensitive: true },
    }),
    { kind: "semantic", role: "button", text: "Sign In", caseSensitive: true, match: "exact" }
  );
  assert.deepEqual(
    normalizeTarget({ target: { kind: "semantic", label: "Email", match: "contains" } }),
    { kind: "semantic", label: "Email", match: "contains", caseSensitive: false }
  );
  assert.throws(
    () => normalizeTarget({ target: { kind: "semantic", caseSensitive: true } }),
    (err) => err.code === "invalid_target"
  );
});

test("legacy selector and text translate only without competing target forms", () => {
  assert.deepEqual(normalizeTarget({ selector: "#submit" }), {
    kind: "css",
    selector: "#submit",
  });
  assert.deepEqual(normalizeTarget({ text: "Sign in" }), {
    kind: "semantic",
    text: "Sign in",
    match: "contains",
    caseSensitive: false,
  });
  assert.throws(
    () => normalizeTarget({ target: { kind: "css", selector: "#x" }, text: "Sign in" }),
    (err) => err.code === "invalid_target"
  );
  assert.throws(
    () => normalizeTarget({ selector: "#x", text: "Sign in" }),
    (err) => err.code === "invalid_target"
  );
  assert.throws(() => normalizeTarget({}), (err) => err.code === "invalid_target");
});

test("semantic matching applies implicit roles, accessible names, labels, and AND fields", () => {
  const button = new FakeElement(
    "button",
    { id: "login", "data-testid": "submit", type: "submit" },
    [new FakeElement("span", {}, [])]
  );
  button.textContent = " Sign   In ";
  const link = new FakeElement("a", { href: "/next", "aria-label": "Next page" });
  const input = new FakeElement("input", { id: "email", type: "text", name: "email" });
  const label = new FakeElement("label", { for: "email" });
  label.textContent = "Email address";
  const hidden = new FakeElement("button", { hidden: "hidden" });
  hidden.textContent = "Hidden";
  const document = fixtureDocument([button, link, input, label, hidden]);

  const refs = new Map();
  const reverse = new WeakMap();
  const registry = { generation: "gen-1", nextRef: 1, refs, reverse };

  const buttonMatches = findTargets(document, registry, normalizeTarget({
    target: { kind: "semantic", role: "button", name: "sign in", testId: "submit" },
  }));
  assert.deepEqual(buttonMatches, [button]);

  const inputMatches = findTargets(document, registry, normalizeTarget({
    target: { kind: "semantic", role: "textbox", label: "email address" },
  }));
  assert.deepEqual(inputMatches, [input]);

  const containsMatches = findTargets(document, registry, normalizeTarget({
    target: { kind: "semantic", name: "next", match: "contains" },
  }));
  assert.deepEqual(containsMatches, [link]);

  const noMatches = findTargets(document, registry, normalizeTarget({
    target: { kind: "semantic", name: "hidden" },
  }));
  assert.deepEqual(noMatches, []);
});

test("state allocates deterministic bounded refs in one document generation", () => {
  const elements = Array.from({ length: 205 }, (_, index) => {
    const element = new FakeElement("button", { id: `button-${index + 1}` });
    element.textContent = `Button ${index + 1}`;
    return element;
  });
  const document = fixtureDocument(elements);
  const registry = ensureDocumentRegistry({});

  const state = collectState(document, registry);
  assert.equal(state.url, "https://example.com/page");
  assert.equal(state.title, "Example");
  assert.equal(typeof registry.generation, "string");
  assert.equal(state.generation, registry.generation);
  assert.equal(state.elements.length, 200);
  assert.deepEqual(
    state.elements.map((element) => element.ref),
    Array.from({ length: 200 }, (_, index) => index + 1)
  );
  assert.deepEqual(state.elements.at(-1), {
    ref: 200,
    tag: "button",
    role: "button",
    name: "Button 200",
    text: "Button 200",
    visible: true,
    disabled: false,
  });
  assert.equal(registry.nextRef, 201);

  const again = collectState(document, registry);
  assert.deepEqual(
    again.elements.map((element) => element.ref),
    state.elements.map((element) => element.ref)
  );
  assert.equal(registry.nextRef, 201);
});

test("registry reuses same-document refs and evicts the least-recently-used record", () => {
  const first = new FakeElement("button", { id: "first" });
  first.textContent = "First";
  const second = new FakeElement("button", { id: "second" });
  second.textContent = "Second";
  const document = fixtureDocument([first, second]);
  const registry = ensureDocumentRegistry({}, { generation: "gen-1", capacity: 2 });

  assert.equal(registry.generation, "gen-1");
  collectState(document, registry);
  assert.equal(registry.reverse.get(first), 1);
  assert.equal(registry.reverse.get(second), 2);

  const third = new FakeElement("button", { id: "third" });
  third.textContent = "Third";
  document.body.children.push(third);
  third.parentNode = document.body;
  const find = findTargets(
    document,
    registry,
    normalizeTarget({ target: { kind: "css", selector: "button" } })
  );
  assert.deepEqual(find, [first, second, third]);

  collectState(document, registry);
  assert.equal(registry.refs.size, 2);
  assert.equal(registry.refs.has(1), false);
  assert.equal(registry.reverse.get(first), undefined);
  assert.deepEqual([...registry.refs.keys()], [2, 3]);
});

test("find allocates refs and returns successful zero-match cardinality", () => {
  const first = new FakeElement("button", { id: "first" });
  first.textContent = "First";
  const document = fixtureDocument([first]);
  const registry = ensureDocumentRegistry({}, { generation: "gen-1" });

  const state = collectState(document, registry);
  assert.equal(state.generation, "gen-1");

  const find = findTargets(
    document,
    registry,
    normalizeTarget({ target: { kind: "css", selector: "input" } })
  );
  assert.deepEqual(find, []);

  const semantic = findTargets(
    document,
    registry,
    normalizeTarget({ target: { kind: "semantic", name: "missing" } })
  );
  assert.deepEqual(semantic, []);
});

test("CSS syntax errors use the structured invalid selector code", () => {
  const document = fixtureDocument([]);
  document.selectors.add("button[");
  assert.throws(
    () =>
      findTargets(
        document,
        ensureDocumentRegistry({}, { generation: "gen-1" }),
        normalizeTarget({ target: { kind: "css", selector: "button[" } })
      ),
    (err) => err.code === "invalid_selector"
  );
});

test("a missing registry creates a new generation and fails old refs closed", () => {
  const first = ensureDocumentRegistry({}, { generation: "gen-1" });
  const second = ensureDocumentRegistry({}, {});
  assert.notEqual(first.generation, second.generation);
});

test("find target snapshots return bounded refs and match counts", () => {
  const elements = Array.from({ length: 202 }, (_, index) => {
    const element = new FakeElement("button", { id: `find-${index + 1}` });
    element.textContent = `Find ${index + 1}`;
    return element;
  });
  const document = fixtureDocument(elements);
  const registry = ensureDocumentRegistry({}, { generation: "gen-1" });

  const result = findTargetSnapshot(
    document,
    registry,
    normalizeTarget({ target: { kind: "semantic", role: "button" } })
  );
  assert.equal(result.generation, "gen-1");
  assert.equal(result.matches_n, 202);
  assert.equal(result.elements.length, 200);
  assert.equal(result.elements[0].ref, 1);
  assert.equal(result.elements.at(-1).ref, 200);

  const empty = findTargetSnapshot(
    document,
    registry,
    normalizeTarget({ target: { kind: "css", selector: "input" } })
  );
  assert.deepEqual(empty, { generation: "gen-1", matches_n: 0, elements: [] });

  assert.throws(
    () =>
      findTargetSnapshot(
        document,
        registry,
normalizeTarget({ target: { kind: "ref", ref: 999, generation: "gen-1" } })
      ),
    (err) => err.code === "unsupported_target"
  );
});

function registeredButton(registry, id = "login", name = "Sign in", generation = "gen-1") {
  const element = new FakeElement("button", { id, name: id, "data-testid": id });
  element.textContent = name;
  const document = fixtureDocument([element]);
  const ref = collectState(document, registry).elements[0].ref;
  return { element, document, ref, target: { kind: "ref", ref, generation } };
}

test("fingerprint refs resolve exact stable and uniquely reidentified nodes", () => {
  const registry = ensureDocumentRegistry({}, { generation: "gen-1" });
  const exact = registeredButton(registry);
  assert.deepEqual(resolveRef(exact.document, registry, exact.target).matchLevel, "exact");

  exact.element.attributes.delete("id");
  exact.element.attributes.delete("name");
  const stable = resolveRef(exact.document, registry, exact.target);
  assert.equal(stable.matchLevel, "stable");
  assert.equal(stable.element, exact.element);

  const softChanged = new FakeElement("button", { id: "login", name: "login", "data-testid": "login", role: "link" });
  softChanged.textContent = "Sign in";
  const softDocument = fixtureDocument([softChanged]);
  const softRegistry = ensureDocumentRegistry({}, { generation: "gen-1" });
  const soft = registeredButton(softRegistry);
  soft.element.attributes.set("role", "link");
  assert.equal(resolveRef(softDocument, softRegistry, soft.target).matchLevel, "stable");

  exact.element.parentNode = null;
  exact.element.isConnected = false;
  const replacement = new FakeElement("button", { id: "login", name: "login", "data-testid": "login" });
  replacement.textContent = "Sign in";
  exact.document.body.children.push(replacement);
  replacement.parentNode = exact.document.body;
  const reidentified = resolveRef(exact.document, registry, exact.target);
  assert.equal(reidentified.matchLevel, "reidentified");
  assert.equal(reidentified.element, replacement);
});

test("fingerprint resolution fails closed for stale generations and evicted refs", () => {
  const registry = ensureDocumentRegistry({}, { generation: "gen-1", capacity: 1 });
  const first = registeredButton(registry);
  assert.throws(
    () => resolveRef(first.document, registry, { ...first.target, generation: "old" }),
    (err) => err.code === "stale_ref_generation"
  );

  const replacement = new FakeElement("button", { id: "next" });
  const second = new FakeElement("button", { id: "second" });
  first.document.body.children.push(replacement, second);
  replacement.parentNode = first.document.body;
  second.parentNode = first.document.body;
  collectState(first.document, registry);
  assert.throws(
    () => resolveRef(first.document, registry, first.target),
    (err) => err.code === "stale_ref_node"
  );
});

test("a connected original below identity threshold does not switch to a replacement", () => {
  const registry = ensureDocumentRegistry({}, { generation: "gen-1" });
  const original = registeredButton(registry);
  original.element.attributes.delete("id");
  original.element.attributes.delete("name");
  original.element.attributes.delete("data-testid");
  original.element.textContent = "Completely different";

  const replacement = new FakeElement("button", {
    id: "login",
    name: "login",
    "data-testid": "login",
  });
  replacement.textContent = "Sign in";
  original.document.body.children.push(replacement);
  replacement.parentNode = original.document.body;

  assert.throws(
    () => resolveRef(original.document, registry, original.target),
    (err) => err.code === "stale_ref_node"
  );
});

test("fingerprints reject hard conflicts and weak or ambiguous candidates", () => {
  const registry = ensureDocumentRegistry({}, { generation: "gen-1" });
  const original = registeredButton(registry);
  original.element.parentNode = null;
  original.element.isConnected = false;

  const hardConflict = new FakeElement("a", { id: "login", href: "/x" });
  const weak = new FakeElement("button");
  const firstTwin = new FakeElement("button", { id: "twin", role: "button" });
  const secondTwin = new FakeElement("button", { id: "twin", role: "button" });
  for (const element of [hardConflict, weak, firstTwin, secondTwin]) {
    original.document.body.children.push(element);
    element.parentNode = original.document.body;
  }
  hardConflict.attributes.set("id", "other");

  assert.throws(
    () => resolveRef(original.document, registry, original.target),
    (err) => err.code === "stale_ref_node"
  );

  firstTwin.attributes.delete("id");
  secondTwin.attributes.delete("id");
  firstTwin.textContent = "Sign in";
  secondTwin.textContent = "Sign in";
  assert.throws(
    () => resolveRef(original.document, registry, original.target),
    (err) => err.code === "reidentification_ambiguous"
  );
});

test("fingerprint element stores compact normalized identity fields", () => {
  const element = new FakeElement("a", {
    id: "link",
    name: "link",
    "data-testid": "link",
    href: "/next",
  });
  element.textContent = "  Next   Page ";
  const document = fixtureDocument([element]);
  assert.deepEqual(fingerprintElement(element, document), {
    tag: "a",
    id: "link",
    testId: "link",
    name: "link",
    href: "/next",
    role: "link",
    accessibleName: "Next Page",
    textPrefix: "Next Page",
    ordinal: 0,
  });
});
