import { escapeHtml } from "../core/dom";
import { renderUiSelectHtml } from "../components/ui-select";
import type { Endpoint, KeyStrategy } from "../core/types";

interface CredentialPreview {
  id: string;
  configured: boolean;
  preview: string;
}

interface PreviewCacheEntry {
  signature: string;
  single?: CredentialPreview;
  credentials: CredentialPreview[];
}

const SUPPORTED_TYPES = new Set([
  "anthropic",
  "openai-chat",
  "openai-responses",
]);
const KEEP_EXISTING_KEY_PLACEHOLDER = "输入新密钥，留空保留现有密钥";
const pendingLegacyCredentialIds = new WeakMap<Endpoint, string>();
const previewCache = new Map<string, PreviewCacheEntry>();
const previewRequests = new Map<string, Promise<boolean>>();

export function supportsMultiKeyRuntime(endpoint: Endpoint): boolean {
  const purpose = String(endpoint.purpose || "");
  return SUPPORTED_TYPES.has(endpoint.type)
    && (!purpose || purpose === "vision_fallback");
}

export function addCredential(endpoint: Endpoint): string {
  endpoint.api_keys ||= [];
  if (endpoint.api_keys.length === 0) {
    const firstId = `cred_${crypto.randomUUID()}`;
    endpoint.api_keys.push({ id: firstId });
    endpoint.key_strategy = "failover";
    if (endpoint.has_api_key) {
      pendingLegacyCredentialIds.set(endpoint, firstId);
    }
    const currentValue = String(endpoint.api_key || "");
    if (currentValue) {
      endpoint.api_key_values ||= {};
      endpoint.api_key_values[firstId] = currentValue;
      delete endpoint.api_key;
    }
  }

  const credentialId = `cred_${crypto.randomUUID()}`;
  endpoint.api_keys.push({ id: credentialId });
  endpoint.api_key_values ||= {};
  return credentialId;
}

export function clearLegacyCredentialMark(endpoint: Endpoint): void {
  pendingLegacyCredentialIds.delete(endpoint);
}

export function removeCredential(
  endpoint: Endpoint,
  credentialId: string,
): boolean {
  if (!endpoint.api_keys || endpoint.api_keys.length <= 1) return false;
  if (pendingLegacyCredentialIds.get(endpoint) === credentialId) return false;
  endpoint.api_keys = endpoint.api_keys.filter(
    (credential) => credential.id !== credentialId,
  );
  if (endpoint.api_key_values) {
    delete endpoint.api_key_values[credentialId];
  }
  return true;
}

export function setCredentialValue(
  endpoint: Endpoint,
  credentialId: string,
  value: string,
): void {
  endpoint.api_key_values ||= {};
  endpoint.api_key_values[credentialId] = value;
}

export function setKeyStrategy(
  endpoint: Endpoint,
  strategy: KeyStrategy,
): void {
  endpoint.key_strategy = strategy;
}

export function clearCredentialPreviews(endpointId?: string): void {
  if (endpointId) {
    previewCache.delete(endpointId);
    previewRequests.delete(endpointId);
    return;
  }
  previewCache.clear();
  previewRequests.clear();
}

export async function loadCredentialPreviews(
  endpoint: Endpoint,
): Promise<boolean> {
  if (!endpoint.id || (!endpoint.has_api_key && !endpoint.api_keys?.length)) {
    return false;
  }
  const signature = endpoint.api_keys?.length
    ? endpoint.api_keys.map((item) => item.id).join("|")
    : "single";
  if (previewCache.get(endpoint.id)?.signature === signature) return false;
  const activeRequest = previewRequests.get(endpoint.id);
  if (activeRequest) return activeRequest;

  const request = (async () => {
    const query = new URLSearchParams({ id: endpoint.id || "" });
    const response = await fetch(`/v1/config/secret-preview?${query}`, {
      headers: { "X-Gateway-Secret-Intent": "reveal" },
      cache: "no-store",
    });
    if (response.status === 404) {
      previewCache.set(endpoint.id || "", { signature, credentials: [] });
      return true;
    }
    if (!response.ok) return false;
    const payload = await response.json();
    previewCache.set(endpoint.id || "", {
      signature,
      single: payload.single,
      credentials: Array.isArray(payload.credentials)
        ? payload.credentials
        : [],
    });
    return true;
  })().finally(() => {
    previewRequests.delete(endpoint.id || "");
  });

  previewRequests.set(endpoint.id, request);
  return request;
}

function singleKeyEditor(
  client: string,
  index: number,
  endpoint: Endpoint,
): string {
  const isWebSearch = endpoint.purpose === "web_search";
  const label = isWebSearch ? "Tavily API Key" : "密钥 (API Key)";
  const preview = singleCredentialPreview(endpoint);
  const placeholder = preview.configured
    ? KEEP_EXISTING_KEY_PLACEHOLDER
    : isWebSearch
      ? "tvly-... 或 env:TAVILY_API_KEY"
      : "输入密钥或 env:变量名";
  const addButton = supportsMultiKeyRuntime(endpoint)
    ? `
      <button type="button" class="btn btn-xs add-key-btn" onclick="addApiKey('${escapeHtml(client)}', ${index})">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        添加更多密钥
      </button>
    `
    : "";

  return `
    <div class="form-group full">
      <div class="key-editor-heading">
        <label>${label} <span class="key-status ${preview.configured ? "key-status-set" : "key-status-unset"}">${preview.configured ? "已配置" : "未配置"}</span></label>
        ${addButton}
      </div>
      <div class="single-key-row">
        <span class="multi-key-preview single-key-preview ${preview.configured ? "is-configured" : ""}">${escapeHtml(preview.preview || "****")}</span>
        <div class="password-input-wrapper">
          <input class="mono" type="password" id="api-key-${escapeHtml(client)}-${index}" value="${escapeHtml(String(endpoint.api_key || ""))}" placeholder="${escapeHtml(placeholder)}" onchange="updateEndpoint('${escapeHtml(client)}', ${index}, 'api_key', this.value)">
          <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('${escapeHtml(client)}', ${index}, 'api-key-${escapeHtml(client)}-${index}')" title="${preview.configured ? "查看已保存密钥" : "显示/隐藏密钥"}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function singleCredentialPreview(endpoint: Endpoint): CredentialPreview {
  if (endpoint.api_key) {
    return { id: endpoint.id || "", configured: true, preview: "待保存" };
  }
  const cached = previewCache.get(endpoint.id || "")?.single;
  if (cached) return cached;
  return {
    id: endpoint.id || "",
    configured: Boolean(endpoint.has_api_key),
    preview: "****",
  };
}

function credentialPreview(
  endpoint: Endpoint,
  credentialId: string,
): CredentialPreview {
  const isLegacy = pendingLegacyCredentialIds.get(endpoint) === credentialId;
  const transient = endpoint.api_key_values?.[credentialId];
  if (transient && !isLegacy) {
    return { id: credentialId, configured: true, preview: "待保存" };
  }
  const cached = previewCache.get(endpoint.id || "")?.credentials.find(
    (item) => item.id === credentialId,
  );
  if (cached) return cached;
  if (pendingLegacyCredentialIds.get(endpoint) === credentialId) {
    return { id: credentialId, configured: true, preview: "已保存密钥" };
  }
  return {
    id: credentialId,
    configured: false,
    preview: "****",
  };
}

const STRATEGY_OPTIONS = [
  { value: "failover", label: "故障转移", description: "主 key 失败后自动切换备用 key" },
  { value: "round-robin", label: "轮询", description: "依次轮流使用每个 key" },
  { value: "random", label: "随机", description: "每次随机选择一个 key" },
];

function strategySelectHtml(
  client: string,
  index: number,
  selected: KeyStrategy,
): string {
  return renderUiSelectHtml({
    id: `key-strategy-${client}-${index}`,
    value: selected,
    options: STRATEGY_OPTIONS,
    onChange: (value: string) => setEndpointKeyStrategy(client, index, value as KeyStrategy),
  });
}

export function renderEndpointKeyEditor(
  client: string,
  index: number,
  endpoint: Endpoint,
): string {
  if (!endpoint.api_keys?.length) {
    return singleKeyEditor(client, index, endpoint);
  }

  const strategy = endpoint.key_strategy || "failover";
  const previews = endpoint.api_keys.map((credential) =>
    credentialPreview(endpoint, credential.id));
  const configuredCount = previews.filter((item) => item.configured).length;

  return `
    <div class="form-group full multi-key-editor">
      <div class="key-editor-heading">
        <label>密钥 (API Key) <span class="key-status ${configuredCount ? "key-status-set" : "key-status-unset"}">${configuredCount} / ${endpoint.api_keys.length} 已配置</span></label>
        <button type="button" class="btn btn-xs add-key-btn" onclick="addApiKey('${escapeHtml(client)}', ${index})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          添加密钥
        </button>
      </div>
      <div class="strategy-field">
        <label class="strategy-field-label">密钥策略</label>
        ${strategySelectHtml(client, index, strategy)}
      </div>
      <div class="multi-key-list">
        ${endpoint.api_keys.map((credential) => {
          const preview = credentialPreview(endpoint, credential.id);
          const isLast = endpoint.api_keys?.length === 1;
          const protectsLegacy =
            pendingLegacyCredentialIds.get(endpoint) === credential.id;
          const deleteDisabled = isLast || protectsLegacy;
          const deleteTitle = isLast
            ? "至少保留一个密钥"
            : protectsLegacy
              ? "首次保存完成后可删除此密钥"
              : "删除密钥";
          const inputId = `api-key-${client}-${index}-${credential.id}`;
          return `
            <div class="multi-key-row">
              <span class="multi-key-preview ${preview.configured ? "is-configured" : ""}" title="${escapeHtml(credential.id)}">${escapeHtml(preview.preview || "****")}</span>
              <input class="mono multi-key-input" type="password" id="${escapeHtml(inputId)}" value="${escapeHtml(endpoint.api_key_values?.[credential.id] || "")}" placeholder="${preview.configured ? KEEP_EXISTING_KEY_PLACEHOLDER : "输入 API Key"}" onchange="updateApiKey('${escapeHtml(client)}', ${index}, '${escapeHtml(credential.id)}', this.value)">
              <button type="button" class="multi-key-action" onclick="toggleMultiKeyVisibility('${escapeHtml(client)}', ${index}, '${escapeHtml(credential.id)}', '${escapeHtml(inputId)}')" title="${preview.configured ? "查看已保存密钥" : "显示/隐藏密钥"}" aria-label="${preview.configured ? "查看已保存密钥" : "显示或隐藏密钥"}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
              <button type="button" class="multi-key-action is-danger" onclick="removeApiKey('${escapeHtml(client)}', ${index}, '${escapeHtml(credential.id)}')" title="${deleteTitle}" aria-label="${deleteTitle}" ${deleteDisabled ? "disabled" : ""}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}
