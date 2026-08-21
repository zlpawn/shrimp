export function createNetworkSession({ tabId, startedAt = Date.now() } = {}) {
  if (!tabId) throw new Error("network capture requires tabId");
  return {
    tabId: Number(tabId),
    startedAt,
    entries: [],
  };
}

export function upsertNetworkEntry(session, entry) {
  if (!session) throw new Error("network session missing");
  const next = { ...session, entries: [...(session.entries || [])] };
  const requestId = entry.requestId;
  const idx = next.entries.findIndex((item) => item.requestId === requestId);
  if (idx >= 0) next.entries[idx] = { ...next.entries[idx], ...entry };
  else next.entries.push(entry);
  return next;
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
