const GATEWAY_DEFAULT = "http://127.0.0.1:8788";

function toNetscapeFormat(cookies) {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# https://curl.haxx.se/rfc/cookie_spec.html",
    "# This is a generated file!  Do not edit.",
    ""
  ];
  for (const c of cookies) {
    const domain = c.domain.startsWith(".") ? c.domain : "." + c.domain;
    const flag = domain.startsWith(".") ? "TRUE" : "FALSE";
    const path = c.path || "/";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expires = Math.round(c.expirationDate || 0);
    lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
  }
  return lines.join("\n") + "\n";
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener("DOMContentLoaded", async () => {
  const domainInput = document.getElementById("domain");
  const cookieCountBadge = document.getElementById("cookie-count");
  const cookieListEl = document.getElementById("cookie-list");
  const downloadBtn = document.getElementById("download-btn");
  const copyHeaderBtn = document.getElementById("copy-header-btn");
  const copyNetscapeBtn = document.getElementById("copy-netscape-btn");
  const exportBtn = document.getElementById("export-btn");
  const gatewayInput = document.getElementById("gateway-url");
  const resultDiv = document.getElementById("result");

  let currentCookies = [];

  function showStatus(html, isError = false) {
    resultDiv.innerHTML = `<span class="${isError ? 'err' : 'ok'}">${html}</span>`;
  }

  async function renderCookieList(domain) {
    cookieListEl.innerHTML = '<div class="empty-tip">正在加载...</div>';
    if (!domain) {
      cookieCountBadge.textContent = "0 cookies";
      cookieListEl.innerHTML = '<div class="empty-tip">请输入域名</div>';
      currentCookies = [];
      return;
    }

    try {
      currentCookies = await chrome.cookies.getAll({ domain });
      cookieCountBadge.textContent = `${currentCookies.length} cookies`;

      if (!currentCookies || currentCookies.length === 0) {
        cookieListEl.innerHTML = '<div class="empty-tip">未找到该域名的 cookie</div>';
        return;
      }

      cookieListEl.innerHTML = "";
      for (const c of currentCookies) {
        const item = document.createElement("div");
        item.className = "cookie-item";

        const info = document.createElement("div");
        info.className = "cookie-info";

        const nameSpan = document.createElement("span");
        nameSpan.className = "cookie-name";
        nameSpan.textContent = c.name;
        nameSpan.title = c.name;

        const valSpan = document.createElement("span");
        valSpan.className = "cookie-preview";
        const valPreview = c.value.length > 20 ? c.value.slice(0, 10) + "..." + c.value.slice(-6) : c.value;
        valSpan.textContent = `=${valPreview}`;

        info.appendChild(nameSpan);
        info.appendChild(valSpan);

        const copyBtn = document.createElement("button");
        copyBtn.className = "copy-single-btn";
        copyBtn.textContent = "复制";
        copyBtn.title = `复制 ${c.name} 的值`;
        copyBtn.addEventListener("click", async () => {
          await navigator.clipboard.writeText(c.value);
          copyBtn.textContent = "已复制";
          setTimeout(() => { copyBtn.textContent = "复制"; }, 1500);
          showStatus(`✅ 已复制 ${c.name} 的值到剪贴板！`);
        });

        item.appendChild(info);
        item.appendChild(copyBtn);
        cookieListEl.appendChild(item);
      }
    } catch (e) {
      cookieListEl.innerHTML = `<div class="empty-tip">读取失败: ${e.message}</div>`;
    }
  }

  // 1. 自动填入当前激活 tab 的域名
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const hostname = new URL(tab.url).hostname;
      const domain = hostname.replace(/^www\./, "");
      domainInput.value = domain;
      await renderCookieList(domain);
    }
  } catch {}

  domainInput.addEventListener("input", () => {
    const domain = domainInput.value.trim();
    renderCookieList(domain);
  });

  // 2. 通用动作：下载 cookies.txt (Netscape 格式)
  downloadBtn.addEventListener("click", () => {
    const domain = domainInput.value.trim();
    if (!currentCookies || currentCookies.length === 0) {
      showStatus("未找到可用 cookie", true);
      return;
    }
    const text = toNetscapeFormat(currentCookies);
    const filename = `cookies-${domain.replace(/[^a-zA-Z0-9.-]/g, "_")}.txt`;
    downloadTextFile(filename, text);
    showStatus(`✅ 成功下载 ${currentCookies.length} 条 cookie 到 Downloads/${filename}`);
  });

  // 3. 通用动作：复制为 HTTP Cookie 标头 (k1=v1; k2=v2)
  copyHeaderBtn.addEventListener("click", async () => {
    if (!currentCookies || currentCookies.length === 0) {
      showStatus("未找到可用 cookie", true);
      return;
    }
    const headerStr = currentCookies.map(c => `${c.name}=${c.value}`).join("; ");
    await navigator.clipboard.writeText(headerStr);
    showStatus(`✅ 已复制完整 Cookie 标头 (包含 ${currentCookies.length} 项) 到剪贴板！`);
  });

  // 4. 通用动作：复制 Netscape 纯文本
  copyNetscapeBtn.addEventListener("click", async () => {
    if (!currentCookies || currentCookies.length === 0) {
      showStatus("未找到可用 cookie", true);
      return;
    }
    const text = toNetscapeFormat(currentCookies);
    await navigator.clipboard.writeText(text);
    showStatus(`✅ 已复制 Netscape cookies.txt 内容到剪贴板！`);
  });

  // 5. 高级可选：导出到本地网关
  if (gatewayInput) {
    const stored = await chrome.storage.local.get("gatewayUrl");
    gatewayInput.value = stored.gatewayUrl || GATEWAY_DEFAULT;
    gatewayInput.addEventListener("change", async () => {
      await chrome.storage.local.set({ gatewayUrl: gatewayInput.value.trim() || GATEWAY_DEFAULT });
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", async () => {
      const domain = domainInput.value.trim();
      const gatewayUrl = (gatewayInput?.value || GATEWAY_DEFAULT).trim();
      if (!currentCookies || currentCookies.length === 0) {
        showStatus("未找到可用 cookie", true);
        return;
      }
      exportBtn.disabled = true;
      exportBtn.textContent = "导出中...";
      try {
        const resp = await fetch(`${gatewayUrl}/v1/cookies/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain,
            cookies: currentCookies.map(c => ({
              domain: c.domain,
              path: c.path,
              name: c.name,
              value: c.value,
              secure: c.secure,
              httponly: c.httpOnly,
              expires: c.expirationDate || 0,
            }))
          })
        });
        const data = await resp.json();
        if (resp.ok) {
          showStatus(`✅ 导出成功: ${data.count} 条 cookie ➔ ${data.file_path}`);
        } else {
          showStatus(`导出失败: ${data.error?.message || "未知错误"}`, true);
        }
      } catch (e) {
        showStatus("无法连接到本地网关，请检查网关是否启动", true);
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = "🌐 导出到网关";
      }
    });
  }
});