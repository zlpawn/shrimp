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

function endpointInfo(value) {
  try {
    const parsed = new URL(value);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
    return { local, port: Number(parsed.port || 0), healthUrl: new URL("/health", parsed).toString() };
  } catch {
    return null;
  }
}

async function defaultProbeGateway(healthUrl) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function inspectCodexConfig(text, {
  configPath = "",
  gatewayPort = 8787,
  probeGateway = defaultProbeGateway,
} = {}) {
  const modelProvider = rootValue(text, "model_provider");
  const modelCatalogJson = rootValue(text, "model_catalog_json");
  const openaiBaseUrl = rootValue(text, "openai_base_url");
  const providerBaseUrl = modelProvider
    ? sectionValue(text, `model_providers.${modelProvider}`, "base_url")
    : "";
  const issues = [];
  const targets = [];
  const probes = new Map();
  const probeTarget = async (value) => {
    if (!probes.has(value)) probes.set(value, await probeGateway(value));
    return probes.get(value);
  };
  const checkTarget = async ({ label, code, value, missingIssue }) => {
    if (!value) {
      issues.push(missingIssue);
      return;
    }
    const target = endpointInfo(value);
    const gateway = target?.local ? await probeTarget(target.healthUrl) : null;
    const healthy = Boolean(gateway?.ok && gateway?.service === "shrimp");
    targets.push({ target, healthy });
    if (!healthy) {
      issues.push({ code, message: `${label} 指向的本机 Shrimp 网关不可用：${value}` });
    }
  };

  if (!modelProvider) issues.push({ code: "model_provider_missing", message: "Codex 未配置 model_provider。" });
  if (!modelCatalogJson) issues.push({ code: "model_catalog_missing", message: "Codex 未配置 model_catalog_json，模型选择列表可能不可用。" });
  await checkTarget({
    label: "openai_base_url",
    code: "gateway_url_mismatch",
    value: openaiBaseUrl,
    missingIssue: { code: "openai_base_url_missing", message: "Codex 未配置 openai_base_url。" },
  });
  await checkTarget({
    label: "模型 Provider 的 base_url",
    code: "provider_url_mismatch",
    value: providerBaseUrl,
    missingIssue: { code: "provider_missing", message: `缺少 [model_providers.${modelProvider || "custom"}] 的 base_url。` },
  });

  const dataPlaneTarget = targets[1]?.target ? targets[1] : targets[0];
  const dataPlaneExternal = targets.some(({ target }) => target?.local && target.port !== Number(gatewayPort));

  return {
    path: configPath,
    healthy: issues.length === 0,
    issues,
    modelProvider,
    modelCatalogJson,
    openaiBaseUrl,
    providerBaseUrl,
    dataPlane: {
      external: dataPlaneExternal,
      gatewayPort: dataPlaneTarget?.target?.port ?? null,
      healthy: targets.length > 0 && targets.every(({ healthy }) => healthy),
    },
    preserved: true,
  };
}
