async function postJson(url, payload, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function syncTarget(url, payload, fetchImpl, bridgePath, gatewayPath) {
  if (await postJson(`${url}${bridgePath}`, payload, fetchImpl)) {
    return { online: true, mode: "bridge" };
  }
  if (await postJson(`${url}${gatewayPath}`, payload, fetchImpl)) {
    return { online: true, mode: "gateway" };
  }
  return { online: false, mode: null };
}

export function registerTarget(url, payload, fetchImpl = fetch) {
  return syncTarget(url, payload, fetchImpl, "/ext/hello", "/v1/extensions/register");
}

export function heartbeatTarget(url, payload, fetchImpl = fetch) {
  return syncTarget(url, payload, fetchImpl, "/ext/heartbeat", "/v1/extensions/heartbeat");
}
