(() => {
  if (window.top !== window) return;
  if (document.getElementById("leo-lantern-root")) return;

  const STORAGE_KEY = "leoLanternBall";
  const SIZE = 56;
  const MARGIN = 12;
  const DRAG_THRESHOLD = 6;

  const root = document.createElement("div");
  root.id = "leo-lantern-root";

  const ball = document.createElement("button");
  ball.id = "leo-lantern-ball";
  ball.type = "button";
  ball.title = "Leo cookie.txt Locally";

  const spinWrapper = document.createElement("div");
  spinWrapper.className = "leo-lantern-spin-wrapper";

  const img = document.createElement("img");
  img.alt = "Leo cookie.txt Locally";
  img.src = chrome.runtime.getURL("icons/icon128.png");
  spinWrapper.appendChild(img);
  ball.appendChild(spinWrapper);

  const panel = document.createElement("div");
  panel.id = "leo-lantern-panel";
  panel.innerHTML = `
    <h2>Leo cookie.txt Locally</h2>
    <label for="leo-lantern-gateway">Shrimp 服务地址</label>
    <input id="leo-lantern-gateway" type="text" placeholder="http://127.0.0.1:8788">
    <label for="leo-lantern-domain">域名</label>
    <input id="leo-lantern-domain" type="text" placeholder="如 bilibili.com">
    <button id="leo-lantern-export" type="button">导出到网关</button>
    <div id="leo-lantern-status"></div>
  `;

  root.append(ball, panel);
  document.documentElement.appendChild(root);

  const gatewayInput = panel.querySelector("#leo-lantern-gateway");
  const domainInput = panel.querySelector("#leo-lantern-domain");
  const exportBtn = panel.querySelector("#leo-lantern-export");
  const statusEl = panel.querySelector("#leo-lantern-status");

  let state = {
    x: window.innerWidth - SIZE - 24,
    y: Math.round(window.innerHeight * 0.62),
    rotation: 0,
  };
  let panelOpen = false;
  let dragging = false;
  let rotating = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applyTransform() {
    const maxX = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
    state.x = clamp(state.x, MARGIN, maxX);
    state.y = clamp(state.y, MARGIN, maxY);
    ball.style.left = `${state.x}px`;
    ball.style.top = `${state.y}px`;
    img.style.transform = `rotate(${state.rotation}deg)`;
    placePanel();
  }

  function placePanel() {
    if (!panelOpen) return;
    const panelWidth = 280;
    const estimatedHeight = 220;
    let left = state.x - panelWidth - 12;
    if (left < MARGIN) left = state.x + SIZE + 12;
    if (left + panelWidth > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, window.innerWidth - panelWidth - MARGIN);
    }
    let top = state.y;
    if (top + estimatedHeight > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, window.innerHeight - estimatedHeight - MARGIN);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function isContextValid() {
    try {
      return Boolean(typeof chrome !== "undefined" && chrome?.runtime && chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function safeStorageGet(keys, callback) {
    if (!isContextValid()) return;
    try {
      chrome.storage.local.get(keys, (res) => {
        try {
          if (!chrome.runtime.lastError && res) {
            callback(res);
          }
        } catch {}
      });
    } catch {}
  }

  function safeStorageSet(obj) {
    if (!isContextValid()) return;
    try {
      chrome.storage.local.set(obj, () => {
        try {
          const _ = chrome.runtime.lastError;
        } catch {}
      });
    } catch {}
  }

  function persist() {
    safeStorageSet({ [STORAGE_KEY]: state });
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = kind ? kind : "";
  }

  function currentDomain() {
    try {
      return location.hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function togglePanel(force) {
    panelOpen = typeof force === "boolean" ? force : !panelOpen;
    panel.classList.toggle("visible", panelOpen);
    ball.classList.toggle("panel-open", panelOpen);
    if (panelOpen) {
      domainInput.value = domainInput.value || currentDomain();
      placePanel();
    }
  }

  safeStorageGet([STORAGE_KEY, "gatewayUrl"], (stored) => {
    if (stored[STORAGE_KEY]) {
      state = { ...state, ...stored[STORAGE_KEY] };
    }
    gatewayInput.value = stored.gatewayUrl || "http://127.0.0.1:8788";
    applyTransform();
  });

  window.addEventListener("resize", applyTransform);

  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let originRotation = 0;
  let moved = false;
  let centerX = 0;
  let centerY = 0;
  let startAngle = 0;

  function pointerAngle(event) {
    return Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
  }

  ball.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    ball.setPointerCapture(event.pointerId);
    startX = event.clientX;
    startY = event.clientY;
    originX = state.x;
    originY = state.y;
    originRotation = state.rotation;
    moved = false;
    rotating = Boolean(event.altKey || event.shiftKey || event.button === 2);
    dragging = !rotating;
    const rect = ball.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    startAngle = pointerAngle(event);
  });

  ball.addEventListener("pointermove", (event) => {
    if (!dragging && !rotating) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
    if (rotating) {
      state.rotation = originRotation + (pointerAngle(event) - startAngle);
    } else {
      state.x = originX + dx;
      state.y = originY + dy;
    }
    applyTransform();
  });

  function endGesture(event) {
    if (!dragging && !rotating) return;
    dragging = false;
    rotating = false;
    try {
      ball.releasePointerCapture(event.pointerId);
    } catch {}
    persist();
    if (!moved && event.type !== "pointercancel") {
      togglePanel();
    }
  }

  ball.addEventListener("pointerup", endGesture);
  ball.addEventListener("pointercancel", endGesture);
  ball.addEventListener("contextmenu", (event) => event.preventDefault());

  ball.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.rotation += event.deltaY > 0 ? 12 : -12;
    applyTransform();
    persist();
  }, { passive: false });

  document.addEventListener("pointerdown", (event) => {
    if (!panelOpen) return;
    if (panel.contains(event.target) || ball.contains(event.target)) return;
    togglePanel(false);
  });

  gatewayInput.addEventListener("change", async () => {
    const url = gatewayInput.value.trim() || "http://127.0.0.1:8788";
    gatewayInput.value = url;
    safeStorageSet({ gatewayUrl: url });
    setStatus("Shrimp 服务地址已保存", "ok");
  });

  exportBtn.addEventListener("click", async () => {
    const gatewayUrl = (gatewayInput.value || "http://127.0.0.1:8788").trim();
    const domain = (domainInput.value || currentDomain()).trim();
    if (!domain) {
      setStatus("请输入域名", "err");
      return;
    }
    if (!isContextValid()) {
      setStatus("扩展已重新加载，请刷新当前网页后重试", "err");
      return;
    }
    exportBtn.disabled = true;
    exportBtn.textContent = "导出中...";
    setStatus("");
    try {
      const result = await chrome.runtime.sendMessage({
        action: "exportCookies",
        gatewayUrl,
        domain,
      });
      if (result?.ok) {
        setStatus(`导出成功: ${result.count} 条 cookie`, "ok");
      } else {
        setStatus(result?.error || "导出失败", "err");
      }
    } catch (err) {
      if (!isContextValid()) {
        setStatus("扩展已重新加载，请刷新当前网页后重试", "err");
      } else {
        setStatus(err.message || "无法连接到扩展", "err");
      }
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "导出到网关";
    }
  });
})();
