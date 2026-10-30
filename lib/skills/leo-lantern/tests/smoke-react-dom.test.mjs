import test from "node:test";
import assert from "node:assert/strict";
import {
  collectState,
  ensureDocumentRegistry,
  findTargets,
  findTargetSnapshot,
  isVisible,
  normalizeTarget,
} from "../../../../extensions/leo-cookie-txt-locally/element-target.mjs";
import { clickTarget } from "../../../../extensions/leo-cookie-txt-locally/interaction.mjs";

class MockDomElement {
  constructor(tag, attributes = {}, text = "", parent = null) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = text;
    this.children = [];
    this.parentNode = parent;
    this.parentElement = parent?.nodeType === 1 ? parent : null;
    this.isConnected = true;
    this.disabled = false;
    this.events = [];
    if (parent && parent.children) {
      parent.children.push(this);
    }
  }

  get id() {
    return this.attributes.get("id") || "";
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  getBoundingClientRect() {
    return { x: 20, y: 50, width: 120, height: 36, top: 50, left: 20 };
  }

  contains(other) {
    for (let current = other; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  click() {
    this.events.push("click");
  }

  dispatchEvent(event) {
    this.events.push(event.type);
  }
}

function createReactMockTree({ insecure = true, background = true } = {}) {
  // 1. Document node: nodeType 9, background tab has hidden: true
  const documentNode = {
    nodeType: 9,
    hidden: background,
    parentNode: null,
    parentElement: null,
  };

  const html = new MockDomElement("html", {}, "", documentNode);
  html.parentElement = null; // In real browsers, documentElement.parentElement is null
  const body = new MockDomElement("body", {}, "", html);
  const root = new MockDomElement("div", { id: "root" }, "", body);
  const appContainer = new MockDomElement("div", { class: "app-container layout-main" }, "", root);

  const elements = [html, body, root, appContainer];

  // Create 15 interactive elements inside nested ancestor divs
  for (let i = 1; i <= 15; i++) {
    const card = new MockDomElement("div", { class: `card card-${i}`, "data-testid": `card-${i}` }, "", appContainer);
    const wrapper = new MockDomElement("div", { class: "card-actions-wrapper" }, "", card);
    const inner = new MockDomElement("div", { class: "action-button-group" }, "", wrapper);
    elements.push(card, wrapper, inner);

    const btnText = i === 1 ? "进入配置" : `操作按钮 ${i}`;
    const btn = new MockDomElement("button", { id: `btn-${i}`, "data-testid": `btn-${i}` }, btnText, inner);
    // Ancestor divs include descendant text
    card.textContent = `卡片内容 ${i} ${btnText}`;
    wrapper.textContent = btnText;
    inner.textContent = btnText;
    elements.push(btn);
  }

  const mockWindow = {
    isSecureContext: !insecure,
    crypto: insecure ? {} : globalThis.crypto,
  };

  const mockDocument = {
    nodeType: 9,
    title: "React SCS App",
    URL: insecure ? "http://iot-scs-fe.ttb.test.ke.com/dashboard" : "https://secure.example.com/dashboard",
    documentElement: html,
    body,
    querySelectorAll(selector) {
      if (selector === "*") return elements;
      if (selector === "label") return [];
      const tag = selector.split(/[.[]/, 1)[0].toUpperCase();
      return elements.filter((el) => el.tagName === tag);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };

  return { mockWindow, mockDocument, elements };
}

test("Smoke: React page in insecure HTTP context produces rich state and non-empty elements", () => {
  const { mockWindow, mockDocument } = createReactMockTree({ insecure: true, background: true });
  const registry = ensureDocumentRegistry(mockWindow, { generation: null });

  assert.ok(typeof registry.generation === "string");
  assert.ok(registry.generation.startsWith("gen_"), "Generation uses insecure fallback in HTTP contexts");

  const state = collectState(mockDocument, registry);
  assert.equal(state.url, "http://iot-scs-fe.ttb.test.ke.com/dashboard");
  assert.ok(state.elements.length >= 15, `Expected >= 15 elements, got ${state.elements.length}`);

  const first = state.elements[0];
  assert.ok(first.ref > 0, "First element has allocated ref");
  assert.equal(first.visible, true);

  const firstBtn = state.elements.find((el) => el.tag === "button");
  assert.ok(firstBtn, "Found button in state elements");
  assert.ok(firstBtn.ref > 0, "Button has allocated ref");
  assert.equal(firstBtn.visible, true);
});

test("Smoke: find by semantic text matches exactly 1 target and filters out all ancestor containers", () => {
  const { mockWindow, mockDocument, elements } = createReactMockTree({ insecure: true, background: true });
  const registry = ensureDocumentRegistry(mockWindow, { generation: null });

  const target = normalizeTarget({ text: "进入配置" });
  const matches = findTargets(mockDocument, registry, target);

  assert.equal(matches.length, 1, `Expected exactly 1 target, got ${matches.length}`);
  const targetBtn = elements.find((el) => el.id === "btn-1");
  assert.equal(matches[0], targetBtn);

  const snapshot = findTargetSnapshot(mockDocument, registry, target);
  assert.equal(snapshot.matches_n, 1);
  assert.equal(snapshot.elements.length, 1);
  assert.equal(snapshot.elements[0].text, "进入配置");
  assert.equal(snapshot.elements[0].tag, "button");
  assert.ok(snapshot.elements[0].ref > 0);
});

test("Smoke: click by text dispatches action on the unique button and records events", () => {
  const { mockWindow, mockDocument, elements } = createReactMockTree({ insecure: true, background: true });
  const registry = ensureDocumentRegistry(mockWindow, { generation: null });

  const target = normalizeTarget({ text: "进入配置" });
  const result = clickTarget(mockDocument, registry, target);

  assert.equal(result.clicked, true);
  assert.equal(result.matches_n, 1);
  assert.equal(result.match_level, "located");
  assert.ok(result.ref > 0);

  const targetBtn = elements.find((el) => el.id === "btn-1");
  assert.deepEqual(targetBtn.events, ["click"]);
});

test("Smoke: Antd Modal with zero-height .ant-modal-root and Chinese spaced '取 消' button is clickable via '取消'", () => {
  const { mockWindow, mockDocument, elements } = createReactMockTree({ insecure: true, background: true });
  const registry = ensureDocumentRegistry(mockWindow, { generation: null });

  // Simulate Ant Design Modal:
  // .ant-modal-root is position: fixed and has height: 0
  const modalRoot = new MockDomElement("div", { class: "ant-modal-root" }, "", mockDocument.body);
  modalRoot.getBoundingClientRect = () => ({ x: 0, y: 0, width: 1441, height: 0, top: 0, left: 0 });

  const modalWrap = new MockDomElement("div", { class: "ant-modal-wrap" }, "", modalRoot);
  modalWrap.getBoundingClientRect = () => ({ x: 0, y: 0, width: 1441, height: 766, top: 0, left: 0 });

  const modalContent = new MockDomElement("div", { class: "ant-modal-content" }, "", modalWrap);
  modalContent.getBoundingClientRect = () => ({ x: 460, y: 100, width: 520, height: 624, top: 100, left: 460 });

  const modalFooter = new MockDomElement("div", { class: "ant-modal-footer" }, "", modalContent);
  modalFooter.getBoundingClientRect = () => ({ x: 460, y: 680, width: 520, height: 44, top: 680, left: 460 });

  // Antd renders two-character Chinese buttons with a space: "取 消"
  const cancelBtn = new MockDomElement("button", { id: "modal-cancel-btn", class: "ant-btn ant-btn-default" }, "取 消", modalFooter);
  cancelBtn.getBoundingClientRect = () => ({ x: 800, y: 685, width: 64, height: 34, top: 685, left: 800 });

  elements.push(modalRoot, modalWrap, modalContent, modalFooter, cancelBtn);

  // 1. isVisible must return true for the button even though its ancestor .ant-modal-root has height: 0
  assert.equal(isVisible(cancelBtn), true, "Modal button must be visible despite zero-height .ant-modal-root");

  // 2. find with text "取消" (no space) must find the "取 消" button
  const findResult = findTargets(mockDocument, registry, normalizeTarget({ text: "取消" }));
  assert.equal(findResult.length, 1);
  assert.equal(findResult[0], cancelBtn);

  // 3. click with text "取消" must succeed
  const clickResult = clickTarget(mockDocument, registry, normalizeTarget({ text: "取消" }));
  assert.equal(clickResult.clicked, true);
  assert.equal(clickResult.matches_n, 1);
  assert.deepEqual(cancelBtn.events, ["click"]);
});
