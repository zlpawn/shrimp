import type { AppConfig, Endpoint } from "../core/types";
import { escapeHtml } from "../core/dom";
import { renderUiSelectHtml } from "../components/ui-select";

export interface CopyTarget {
  client: string;
  protocol?: string;
}

export interface RevealedEndpointSecrets {
  single?: string;
  credentials?: Record<string, string>;
}

export interface CopyNodeState {
  targetClient: string;
  sourceClient: string;
  sourceEndpointId: string;
  sourceEndpointIndex: number;
}

type CopyConfirmHandler = (draft: Endpoint) => void | Promise<void>;

const CHAT_PROTOCOL_TYPES = new Set([
  "anthropic",
  "openai-chat",
  "openai-responses",
  "grok",
]);

const CLIENT_NAMES: Record<string, string> = {
  code: "Claude Code",
  desktop: "Claude Desktop",
  codex: "Codex",
  deeptutor: "DeepTutor",
};

const PURPOSE_NAMES: Record<string, string> = {
  chat: "聊天模型",
  vision_fallback: "视觉兜底",
  web_search: "联网搜索",
  embedding: "向量模型",
  image_generation: "图片生成",
  video_generation: "视频生成",
  text_to_speech: "语音合成",
};

const protocolHints = new Map<string, string>();
let modalKeydownHandler: ((event: KeyboardEvent) => void) | null = null;

export function inferCopiedEndpointType(
  targetClient: string,
  targetProtocol: string | undefined,
  sourceEndpoint: Endpoint,
): string {
  if (!CHAT_PROTOCOL_TYPES.has(sourceEndpoint.type)) return sourceEndpoint.type;
  if (targetClient === "codex" || targetClient === "deeptutor") {
    return "openai-responses";
  }
  if (targetClient === "code" || targetClient === "desktop") {
    return "anthropic";
  }
  return targetProtocol === "openai" ? "openai-responses" : "anthropic";
}

export function buildEndpointCopyDraft(
  sourceEndpoint: Endpoint,
  target: CopyTarget,
  revealedSecrets: RevealedEndpointSecrets,
  idFactory: () => string = () => `ep_${crypto.randomUUID()}`,
  credentialIdFactory: () => string = () => `cred_${crypto.randomUUID()}`,
): Endpoint {
  const draft = structuredClone(sourceEndpoint);
  draft.id = idFactory();
  draft.type = inferCopiedEndpointType(
    target.client,
    target.protocol,
    sourceEndpoint,
  );
  draft.is_default = false;
  delete draft.api_key;
  delete draft.api_key_env;
  delete draft.has_api_key;
  delete draft.api_key_values;

  if (sourceEndpoint.api_keys?.length) {
    draft.api_keys = [];
    draft.api_key_values = {};
    for (const sourceCredential of sourceEndpoint.api_keys) {
      const credentialId = credentialIdFactory();
      draft.api_keys.push({ id: credentialId });
      const apiKey = revealedSecrets.credentials?.[sourceCredential.id];
      if (apiKey) draft.api_key_values[credentialId] = apiKey;
    }
  } else if (revealedSecrets.single) {
    draft.api_key = revealedSecrets.single;
  }

  return draft;
}

export function listCopySources(config: AppConfig, targetClient: string) {
  return Object.entries(config.clients || {})
    .filter(([client]) => client !== targetClient)
    .map(([client, value]) => ({
      client,
      endpoints: value.endpoints || [],
    }));
}

export async function revealEndpointSecrets(
  endpoint: Endpoint,
): Promise<RevealedEndpointSecrets> {
  if (endpoint.api_keys?.length) {
    const transientValues = endpoint.api_key_values || {};
    if (Object.keys(transientValues).length) {
      return { credentials: { ...transientValues } };
    }
  } else if (endpoint.api_key) {
    return { single: endpoint.api_key };
  }

  if (!endpoint.id) return {};
  const headers = { "X-Gateway-Secret-Intent": "reveal" };

  if (!endpoint.api_keys?.length) {
    const query = new URLSearchParams({ id: endpoint.id });
    const response = await fetch(`/v1/config/secret?${query}`, {
      headers,
      cache: "no-store",
    });
    if (response.status === 404) return {};
    if (!response.ok) throw new Error("读取源节点密钥失败");
    const payload = await response.json();
    return { single: payload.api_key || "" };
  }

  const credentials: Record<string, string> = {};
  for (const credential of endpoint.api_keys) {
    const query = new URLSearchParams({
      id: endpoint.id,
      credential_id: credential.id,
    });
    const response = await fetch(`/v1/config/secret?${query}`, {
      headers,
      cache: "no-store",
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error("读取源节点密钥失败");
    const payload = await response.json();
    credentials[credential.id] = payload.api_key || "";
  }
  return { credentials };
}

export function getCopyProtocolHint(endpointId: string | undefined): string {
  return endpointId ? protocolHints.get(endpointId) || "" : "";
}

function clientName(client: string): string {
  return CLIENT_NAMES[client] || client;
}

function endpointPurpose(endpoint: Endpoint): string {
  return PURPOSE_NAMES[endpoint.purpose || "chat"] || endpoint.purpose || "聊天模型";
}

function endpointTypeLabel(type: string): string {
  if (type === "anthropic") return "Anthropic";
  if (type === "openai-responses") return "OpenAI Responses";
  if (type === "openai-chat") return "OpenAI Chat";
  return type;
}

function rememberProtocolHint(
  sourceEndpoint: Endpoint,
  draft: Endpoint,
  targetClient: string,
): void {
  if (!draft.id || sourceEndpoint.type === draft.type) return;
  protocolHints.set(
    draft.id,
    `已根据 ${clientName(targetClient)} 的接入方式，将节点协议从 ${endpointTypeLabel(sourceEndpoint.type)} 调整为 ${endpointTypeLabel(draft.type)}。请确认 Base URL 与模型配置兼容后再保存。`,
  );
}

export function closeCopyNodeModal(): void {
  document.getElementById("copy-node-modal")?.remove();
  if (modalKeydownHandler) {
    document.removeEventListener("keydown", modalKeydownHandler, true);
    modalKeydownHandler = null;
  }
}

export function openCopyNodeModal(
  targetClient: string,
  config: AppConfig,
  onConfirm: CopyConfirmHandler,
): void {
  closeCopyNodeModal();

  const sources = listCopySources(config, targetClient);
  const state: CopyNodeState = {
    targetClient,
    sourceClient: sources[0]?.client || "",
    sourceEndpointId: "",
    sourceEndpointIndex: -1,
  };

  const overlay = document.createElement("div");
  overlay.id = "copy-node-modal";
  overlay.className = "copy-node-overlay open";
  overlay.innerHTML = `
    <div class="copy-node-modal" role="dialog" aria-modal="true" aria-labelledby="copy-node-title">
      <div class="copy-node-modal-header">
        <div>
          <h3 id="copy-node-title">复制节点到 ${escapeHtml(clientName(targetClient))}</h3>
          <p>选择一个已有节点生成草稿，确认配置后再手动保存。</p>
        </div>
        <button type="button" class="copy-node-close" aria-label="关闭复制节点窗口" title="关闭">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="copy-node-body">
        <div class="copy-node-field">
          <label>来源客户端</label>
          ${renderUiSelectHtml({
            id: "copy-node-source-client",
            value: state.sourceClient,
            disabled: !sources.length,
            placeholder: "暂无可复制客户端",
            options: sources.map((source) => ({
              value: source.client,
              label: clientName(source.client),
              description: `${source.endpoints.length} 个可复制节点`,
            })),
            onChange: (value) => {
              state.sourceClient = value;
              renderEndpoints();
            },
          })}
        </div>
        <div class="copy-node-list-header">
          <span>配置节点</span>
          <span id="copy-node-source-count"></span>
        </div>
        <div class="copy-node-source-list" id="copy-node-source-list"></div>
        <div class="copy-node-error" id="copy-node-error" role="alert"></div>
      </div>
      <div class="copy-node-actions">
        <button type="button" class="btn copy-node-cancel">取消</button>
        <button type="button" class="btn btn-primary" id="copy-node-confirm" disabled>创建副本</button>
      </div>
    </div>
  `;

  const sourceList = overlay.querySelector<HTMLElement>(
    "#copy-node-source-list",
  );
  const sourceCount = overlay.querySelector<HTMLElement>(
    "#copy-node-source-count",
  );
  const confirmButton = overlay.querySelector<HTMLButtonElement>(
    "#copy-node-confirm",
  );
  const errorMessage = overlay.querySelector<HTMLElement>("#copy-node-error");

  const renderEndpoints = () => {
    const source = sources.find((item) => item.client === state.sourceClient);
    const endpoints = source?.endpoints || [];
    state.sourceEndpointId = "";
    state.sourceEndpointIndex = -1;
    if (confirmButton) confirmButton.disabled = true;
    if (errorMessage) errorMessage.textContent = "";
    if (sourceCount) sourceCount.textContent = `${endpoints.length} 个可选项`;
    if (!sourceList) return;

    if (!sources.length) {
      sourceList.innerHTML = `
        <div class="copy-node-empty">没有其他客户端可作为复制来源。</div>
      `;
      return;
    }
    if (!endpoints.length) {
      sourceList.innerHTML = `
        <div class="copy-node-empty">这个客户端还没有可复制的节点。</div>
      `;
      return;
    }

    sourceList.innerHTML = endpoints.map((endpoint, index) => {
      const detail = `${endpointTypeLabel(endpoint.type)} · ${endpointPurpose(endpoint)}`;
      return `
        <button
          type="button"
          class="copy-node-source-item"
          data-endpoint-index="${index}"
          aria-pressed="false">
          <span class="copy-node-source-main">
            <span class="copy-node-source-name">${escapeHtml(endpoint.name || `节点 ${index + 1}`)}</span>
            <span class="copy-node-source-url">${escapeHtml(endpoint.base_url || "未配置 Base URL")}</span>
          </span>
          <span class="copy-node-source-meta">
            ${escapeHtml(detail)}
          </span>
        </button>
      `;
    }).join("");
  };

  sourceList?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      ".copy-node-source-item",
    );
    if (!button || button.disabled) return;
    const endpointIndex = Number(button.dataset.endpointIndex);
    const source = sources.find((item) => item.client === state.sourceClient);
    const endpoint = source?.endpoints[endpointIndex];
    if (!endpoint) return;

    state.sourceEndpointIndex = endpointIndex;
    state.sourceEndpointId = endpoint.id || "";
    sourceList.querySelectorAll(".copy-node-source-item").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    if (confirmButton) confirmButton.disabled = false;
    if (errorMessage) errorMessage.textContent = "";
  });

  confirmButton?.addEventListener("click", async () => {
    const source = sources.find((item) => item.client === state.sourceClient);
    const sourceEndpoint = source?.endpoints[state.sourceEndpointIndex];
    if (!sourceEndpoint || !confirmButton) return;

    const originalLabel = confirmButton.textContent || "创建副本";
    confirmButton.disabled = true;
    confirmButton.textContent = "正在读取密钥...";
    if (errorMessage) errorMessage.textContent = "";
    try {
      const secrets = await revealEndpointSecrets(sourceEndpoint);
      const draft = buildEndpointCopyDraft(
        sourceEndpoint,
        {
          client: targetClient,
          protocol: String(config.clients[targetClient]?.protocol || ""),
        },
        secrets,
      );
      rememberProtocolHint(sourceEndpoint, draft, targetClient);
      await onConfirm(draft);
      closeCopyNodeModal();
    } catch (error) {
      if (errorMessage) {
        errorMessage.textContent = error instanceof Error
          ? error.message
          : "复制节点失败";
      }
      confirmButton.disabled = false;
      confirmButton.textContent = originalLabel;
    }
  });

  overlay.querySelector(".copy-node-close")?.addEventListener(
    "click",
    closeCopyNodeModal,
  );
  overlay.querySelector(".copy-node-cancel")?.addEventListener(
    "click",
    closeCopyNodeModal,
  );
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeCopyNodeModal();
  });

  modalKeydownHandler = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeCopyNodeModal();
  };
  document.addEventListener("keydown", modalKeydownHandler, true);
  document.body.appendChild(overlay);
  renderEndpoints();
  overlay.querySelector<HTMLElement>(
    "#ui-select-copy-node-source-client .ui-select-trigger",
  )?.focus();
}
