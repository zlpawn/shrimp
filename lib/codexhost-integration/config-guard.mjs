function unquote(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && text[0] === '"' && text.at(-1) === '"') {
    return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (text.length >= 2 && text[0] === "'" && text.at(-1) === "'") {
    return text.slice(1, -1);
  }
  return text;
}

function rootValue(text, key) {
  const root = String(text || "").split(/^\s*\[/m, 1)[0];
  const match = root.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
  return match ? unquote(match[1]) : "";
}

function sectionValue(text, section, key) {
  let activeSection = "";
  for (const line of String(text || "").split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      activeSection = sectionMatch[1].trim();
      continue;
    }
    if (activeSection !== section) continue;
    const value = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`));
    if (value) return unquote(value[1]);
  }
  return "";
}

function endpointPort(value) {
  try {
    const parsed = new URL(value);
    if (!(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) return null;
    return Number(parsed.port || 0);
  } catch {
    return null;
  }
}

export function inspectCodexConfig(text, { configPath = "", gatewayPort = 8787 } = {}) {
  const modelProvider = rootValue(text, "model_provider");
  const modelCatalogJson = rootValue(text, "model_catalog_json");
  const openaiBaseUrl = rootValue(text, "openai_base_url");
  const providerBaseUrl = modelProvider
    ? sectionValue(text, `model_providers.${modelProvider}`, "base_url")
    : "";
  const issues = [];

  if (!modelProvider) issues.push({ code: "model_provider_missing", message: "Codex 未配置 model_provider。" });
  if (!modelCatalogJson) issues.push({ code: "model_catalog_missing", message: "Codex 未配置 model_catalog_json，模型选择列表可能不可用。" });
  if (!openaiBaseUrl) {
    issues.push({ code: "openai_base_url_missing", message: "Codex 未配置 openai_base_url。" });
  } else if (endpointPort(openaiBaseUrl) !== Number(gatewayPort)) {
    issues.push({ code: "gateway_url_mismatch", message: `openai_base_url 未指向本机 Shrimp 网关端口 ${gatewayPort}。` });
  }
  if (!providerBaseUrl) {
    issues.push({ code: "provider_missing", message: `缺少 [model_providers.${modelProvider || "custom"}] 的 base_url。` });
  } else if (endpointPort(providerBaseUrl) !== Number(gatewayPort)) {
    issues.push({ code: "provider_url_mismatch", message: `模型 Provider 的 base_url 未指向本机 Shrimp 网关端口 ${gatewayPort}。` });
  }

  return {
    path: configPath,
    healthy: issues.length === 0,
    issues,
    modelProvider,
    modelCatalogJson,
    openaiBaseUrl,
    providerBaseUrl,
    preserved: true,
  };
}
