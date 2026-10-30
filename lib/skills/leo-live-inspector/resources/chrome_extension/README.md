# Leo cookie.txt Locally

A Chrome/Edge/Brave extension that exports cookies from the browser to the Shrimp gateway.

## Installation

1. Download the zip from the gateway's "浏览器插件" panel (or use this folder).
2. Unzip to a folder if needed.
3. Open `chrome://extensions`.
4. Enable "Developer mode" (top right).
5. Click "Load unpacked" and select the unzipped folder.
6. After upgrading to 1.3.1+, click **Reload** on the extension card.

---

> [!IMPORTANT]
> **📢 AI Agent 与开发者同步规约（Single Source of Truth）**：
> 1. 本目录 (`extensions/leo-cookie-txt-locally`) 为 Chrome 扩展的**主源目录**。
> 2. 为保证 `lib/skills/leo-live-inspector` 与外部独立仓库 `leo-live-runner/skills/leo-live-inspector` 具备独立分发与便携性，其 `resources/chrome_extension` 目录下维护了本扩展的自包含副本。
> 3. **任何修改在合并至本主源目录后，请执行同步脚本，确保将最新改动同步到所有副本目录！**

---

## 自动获取 skill 凭据（credential_relay）

安装或更新至 1.3.1 并重新加载扩展，在同一个普通 Profile 登录业务网站后，直接运行 skill 命令。无需手动复制、导入配对文件或启动网关。

- 缓存可用时不启动 relay；凭据缺失或明确登录失败时，业务进程临时监听 `127.0.0.1:19528`。
- 扩展启动及约每 60 秒探测一次。只有领取到任务才调用 `chrome.cookies.getAll({url})`，按可选 `names` 筛选后回传。
- 任务仅保存在业务进程内存，默认等待 180 秒，完成、超时或取消后关闭服务。扩展不缓存回传凭据。
- 无配对密钥，信任本机程序；仅支持同机单普通 Profile。多个扩展 Profile 可能竞争任务，请只启用一个。
- 支持 Cookie 和 Cookie 中的 Token（含 HttpOnly），不支持分区 Cookie、localStorage、sessionStorage 或请求头 Token。
- 超时请打开浏览器、检查扩展并登录目标网站后重试。`LEO_INSPECTOR_BROWSER_CREDENTIALS=off` 关闭 skill 自动获取。
- 业务脚本只读验证成功后更新原有缓存，构建、发布等写请求不自动重放。手动复制/导出功能保留。

新通道独立于以下既有网关接口。旧网关离线时同样由每分钟 alarm 唤醒探测。

---

## Usage

### Via agent / skill (Path C)
1. Ensure the extension is loaded and the gateway is running.
2. Create a task:
   ```bash
   curl -s -X POST http://127.0.0.1:8788/v1/cookies/export-via-extension \
     -H 'Content-Type: application/json' \
     -d '{"domain":"bilibili.com"}'
   ```
3. Poll every 2s, max 30 times:
   ```bash
   curl -s http://127.0.0.1:8788/v1/cookies/export-via-extension/TASK_ID
   ```
4. On `status=succeeded`, use `result.file_path` with yt-dlp.

The extension claims tasks every ~2s while registered. The gateway page does not need to stay open.

## Agent task isolation and stable targets

Agent browser commands run inside a claimed tab or tab group. The extension reconciles windows, groups, and claims on startup and repeated `task.start`; it never adopts unrelated user tabs as task-owned.

Protocol consumers can call `dom.state` for a bounded snapshot of up to 200 interactive elements. Each element gets an integer `ref` and a document-scoped opaque `generation`.

`dom.find` accepts one CSS or semantic target and returns up to 200 allocated refs. Its response includes the full `matches_n`; zero matches are successful.

Actions accept exactly one target form:

```json
{ "kind": "ref", "ref": 12, "generation": "4d0f..." }
{ "kind": "css", "selector": "button.primary" }
{ "kind": "semantic", "role": "button", "name": "Sign in", "match": "exact", "caseSensitive": false }
```

Semantic fields combine with AND. Supported fields are `role`, `name`, `text`, `label`, and `testId`. Legacy top-level `selector` maps to CSS; legacy `text` maps to a contains semantic match only when no competing target form is supplied.

Ref actions return `match_level: exact | stable | reidentified`. A top-level navigation destroys the document registry and old generation; an extension reload creates a new generation. Old refs fail closed rather than operating on an unrelated element.

Structured target errors use stable codes such as `invalid_target`, `stale_ref_generation`, `stale_ref_node`, `reidentification_ambiguous`, `invalid_selector`, `selector_not_found`, `selector_ambiguous`, `semantic_not_found`, `semantic_ambiguous`, `unsupported_target`, `target_disabled`, and `fill_verification_failed`.

### Via popup (Path B)
1. Navigate to the website you want to export cookies from (e.g. bilibili.com).
2. Click the extension icon in the toolbar.
3. The domain is auto-filled from the current tab. Adjust if needed.
4. Click "导出到网关".

### Via gateway page (Path A)
1. Open the gateway's video-kb cookie panel in Chrome.
2. Click "用浏览器插件导出".
3. The extension reads cookies in the background and sends them to the gateway.
