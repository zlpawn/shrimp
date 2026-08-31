export function createNetworkBuffer(limit = 1_000) {
  return {
    limit: Math.max(1, Number(limit) || 1_000),
    entriesById: new Map(),
  };
}

export function createNetworkSession({
  tabId,
  startedAt = Date.now(),
  attachedByLantern = false,
  stoppedAt = null,
  entryCount = 0,
  recovered = false,
  entriesLost = false,
} = {}) {
  if (!tabId) throw new Error("network capture requires tabId");
  return {
    tabId: Number(tabId),
    attachedByLantern: Boolean(attachedByLantern),
    startedAt,
    stoppedAt,
    entryCount: Number(entryCount) || 0,
    recovered: Boolean(recovered),
    entriesLost: Boolean(entriesLost),
  };
}

export function upsertNetworkEntry(buffer, entry) {
  if (!buffer?.entriesById || !(buffer.entriesById instanceof Map)) {
    throw new Error("network buffer missing");
  }
  const requestId = String(entry?.requestId || "");
  if (!requestId) throw new Error("network entry requires requestId");
  const current = buffer.entriesById.get(requestId);
  if (current) {
    buffer.entriesById.set(requestId, { ...current, ...entry, requestId });
    return buffer;
  }
  while (buffer.entriesById.size >= buffer.limit) {
    buffer.entriesById.delete(buffer.entriesById.keys().next().value);
  }
  buffer.entriesById.set(requestId, { ...entry, requestId });
  return buffer;
}

export function getNetworkEntries(buffer) {
  if (!buffer?.entriesById || !(buffer.entriesById instanceof Map)) return [];
  return [...buffer.entriesById.values()];
}

export function filterNetworkEntries(entries = [], grep = "") {
  const needle = String(grep || "").trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => {
    const blob = `${entry.method || ""} ${entry.url || ""} ${entry.status || ""} ${entry.mimeType || ""}`.toLowerCase();
    return blob.includes(needle);
  });
}

export function toNetworkSummary(entry) {
  return {
    requestId: entry.requestId,
    method: entry.method || "GET",
    url: entry.url || "",
    status: entry.status ?? null,
    mimeType: entry.mimeType || null,
    type: entry.type || null,
    timestamp: entry.timestamp || null,
  };
}
