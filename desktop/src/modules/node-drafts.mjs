function clone(value) {
  return structuredClone(value);
}

function endpointsOf(config, client) {
  return config?.clients?.[client]?.endpoints || [];
}

function endpointIndex(config, client, selection = {}) {
  const endpoints = endpointsOf(config, client);
  if (selection.id) {
    return endpoints.findIndex((endpoint) => endpoint.id === selection.id);
  }
  const index = Number(selection.index);
  return Number.isInteger(index) && index >= 0 && index < endpoints.length
    ? index
    : -1;
}

function equal(left, right) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function ensureClient(target, source, client) {
  target.clients ||= {};
  if (!target.clients[client]) {
    target.clients[client] = clone(source?.clients?.[client] || { endpoints: [] });
    target.clients[client].endpoints = [];
  }
  target.clients[client].endpoints ||= [];
  return target.clients[client];
}

function endpointDefaultGroup(endpoint) {
  const purpose = String(endpoint?.purpose || "");
  if (purpose === "embedding") return "embedding";
  if (purpose === "web_search") return "web_search";
  if (purpose && purpose !== "chat") return purpose;
  return "chat";
}

function sanitizeSavedEndpoint(endpoint) {
  const next = clone(endpoint);
  if (next.api_key || next.api_key_values) next.has_api_key = true;
  delete next.api_key;
  delete next.api_key_env;
  delete next.api_key_values;
  return next;
}

export function isEndpointDraft(
  persisted,
  working,
  client,
  selection,
) {
  const workingIndex = endpointIndex(working, client, selection);
  if (workingIndex < 0) return false;
  const endpoint = endpointsOf(working, client)[workingIndex];
  const persistedIndex = endpointIndex(persisted, client, {
    id: endpoint.id,
    index: selection?.index,
  });
  if (persistedIndex < 0) return true;
  return !equal(endpoint, endpointsOf(persisted, client)[persistedIndex]);
}

export function collectEndpointDrafts(persisted, working) {
  const drafts = [];
  for (const [client, body] of Object.entries(working?.clients || {})) {
    for (const [index, endpoint] of (body?.endpoints || []).entries()) {
      const persistedIndex = endpointIndex(persisted, client, {
        id: endpoint.id,
        index,
      });
      const persistedEndpoint = persistedIndex >= 0
        ? endpointsOf(persisted, client)[persistedIndex]
        : null;
      if (!persistedEndpoint || !equal(endpoint, persistedEndpoint)) {
        drafts.push({
          client,
          id: endpoint.id || "",
          index,
          endpoint: clone(endpoint),
          isNew: !persistedEndpoint,
        });
      }
    }
  }
  return drafts;
}

export function applyEndpointDrafts(base, drafts = []) {
  const next = clone(base);
  for (const draft of drafts) {
    const client = ensureClient(next, base, draft.client);
    const existingIndex = endpointIndex(next, draft.client, {
      id: draft.id,
      index: draft.isNew ? -1 : draft.index,
    });
    if (existingIndex >= 0) {
      client.endpoints[existingIndex] = clone(draft.endpoint);
      continue;
    }
    const insertAt = Math.max(0, Math.min(draft.index, client.endpoints.length));
    client.endpoints.splice(insertAt, 0, clone(draft.endpoint));
  }
  return next;
}

export function discardEndpointDraft(
  persisted,
  working,
  client,
  selection,
) {
  const next = clone(working);
  const workingIndex = endpointIndex(next, client, selection);
  if (workingIndex < 0) return next;
  const workingEndpoint = endpointsOf(next, client)[workingIndex];
  const persistedIndex = endpointIndex(persisted, client, {
    id: workingEndpoint.id,
    index: selection?.index,
  });
  if (persistedIndex < 0) {
    next.clients[client].endpoints.splice(workingIndex, 1);
  } else {
    next.clients[client].endpoints[workingIndex] = clone(
      endpointsOf(persisted, client)[persistedIndex],
    );
  }
  return next;
}

export function buildNodeSaveConfig(
  persisted,
  working,
  client,
  selection,
) {
  const next = clone(persisted);
  const sourceIndex = endpointIndex(working, client, selection);
  if (sourceIndex < 0) return next;
  const sourceEndpoint = endpointsOf(working, client)[sourceIndex];
  const targetClient = ensureClient(next, working, client);
  const targetIndex = endpointIndex(next, client, {
    id: sourceEndpoint.id,
    index: selection?.index,
  });
  if (targetIndex >= 0) {
    targetClient.endpoints[targetIndex] = clone(sourceEndpoint);
  } else {
    const insertAt = Math.max(0, Math.min(sourceIndex, targetClient.endpoints.length));
    targetClient.endpoints.splice(insertAt, 0, clone(sourceEndpoint));
  }
  if (sourceEndpoint.is_default === true) {
    const group = endpointDefaultGroup(sourceEndpoint);
    targetClient.endpoints.forEach((endpoint) => {
      endpoint.is_default = endpoint.id === sourceEndpoint.id
        ? true
        : endpointDefaultGroup(endpoint) === group
          ? false
          : endpoint.is_default;
    });
  }
  if (client === "code" && working?.clients?.code?.model_slots) {
    targetClient.model_slots = clone(working.clients.code.model_slots);
  }
  return next;
}

export function buildScopedSaveConfig(persisted, working, options = {}) {
  const scope = options.scope || "global";
  const client = options.client || "";
  if (scope === "node") {
    return buildNodeSaveConfig(
      persisted,
      working,
      client,
      options.endpoint || {},
    );
  }
  if (scope === "exposure" || scope === "enabled") {
    const next = clone(persisted);
    const sourceIndex = endpointIndex(
      working,
      client,
      options.endpoint || {},
    );
    if (sourceIndex < 0) return next;
    const sourceEndpoint = endpointsOf(working, client)[sourceIndex];
    const targetIndex = endpointIndex(next, client, {
      id: sourceEndpoint.id,
      index: options.endpoint?.index,
    });
    if (targetIndex < 0) return next;
    const field = scope === "exposure" ? "expose_models" : "enabled";
    next.clients[client].endpoints[targetIndex][field] = sourceEndpoint[field];
    return next;
  }
  if (scope === "proxy") {
    const next = clone(persisted);
    const sourceIndex = endpointIndex(
      working,
      client,
      options.endpoint || {},
    );
    if (sourceIndex < 0) return next;
    const sourceEndpoint = endpointsOf(working, client)[sourceIndex];
    const targetIndex = endpointIndex(next, client, {
      id: sourceEndpoint.id,
      index: options.endpoint?.index,
    });
    if (targetIndex < 0) return next;
    const targetEndpoint = next.clients[client].endpoints[targetIndex];
    for (const field of ["proxy", "proxy_mode", "proxy_url"]) {
      if (field in sourceEndpoint) targetEndpoint[field] = sourceEndpoint[field];
      else delete targetEndpoint[field];
    }
    return next;
  }
  if (scope === "client") {
    const next = clone(persisted);
    const target = ensureClient(next, working, client);
    const source = working?.clients?.[client] || {};
    for (const [key, value] of Object.entries(source)) {
      if (key !== "endpoints") target[key] = clone(value);
    }
    return next;
  }
  if (scope === "delete") {
    const next = clone(persisted);
    const target = ensureClient(next, working, client);
    const deletedId = options.deletedEndpointId || "";
    if (deletedId) {
      target.endpoints = target.endpoints.filter(
        (endpoint) => endpoint.id !== deletedId,
      );
    } else if (Number.isInteger(options.deletedEndpointIndex)) {
      target.endpoints.splice(options.deletedEndpointIndex, 1);
    }
    return next;
  }
  if (["default", "default-embedding", "default-web-search"].includes(scope)) {
    const next = clone(persisted);
    const target = ensureClient(next, working, client);
    target.endpoints.forEach((endpoint, index) => {
      const workingIndex = endpointIndex(working, client, {
        id: endpoint.id,
        index,
      });
      if (workingIndex >= 0) {
        endpoint.is_default = endpointsOf(working, client)[workingIndex]
          .is_default === true;
      }
    });
    if (client === "code" && working?.clients?.code?.model_slots) {
      target.model_slots = clone(working.clients.code.model_slots);
    }
    return next;
  }
  return clone(working);
}

export function reconcileWorkingConfigAfterSave(
  saved,
  working,
  options = {},
) {
  if (["global", "template"].includes(options.scope)) return clone(saved);

  const next = clone(working);
  if (options.scope !== "node") return next;

  const client = options.client || "";
  const savedIndex = endpointIndex(saved, client, options.endpoint || {});
  const workingIndex = endpointIndex(next, client, options.endpoint || {});
  if (savedIndex < 0 || workingIndex < 0) return next;
  next.clients[client].endpoints[workingIndex] = sanitizeSavedEndpoint(
    endpointsOf(saved, client)[savedIndex],
  );
  return next;
}
