import type {
  AppConfig,
  AnalyticsResponse,
  DreamSkinCapabilities,
  DreamSkinLibraryResponse,
  DreamSkinMarketResponse,
  DreamSkinThemeDetail,
  DreamSkinThemeMutation,
  DreamSkinApiError,
} from "./types";

export async function getConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch("/v1/config");
    if (res.ok) return await res.json();
  } catch {
    console.warn("Failed to fetch config.");
  }
  return null;
}

export async function saveConfig(config: AppConfig): Promise<boolean> {
  try {
    const res = await fetch("/v1/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getAnalyticsData(params: Record<string, string>): Promise<AnalyticsResponse | null> {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/v1/analytics/token-usage?${qs}`);
    if (res.ok) return await res.json();
  } catch {
    console.warn("Failed to fetch analytics.");
  }
  return null;
}

export async function loadSyncStatus(): Promise<unknown> {
  try {
    const res = await fetch("/v1/sync/status");
    if (res.ok) return await res.json();
  } catch {
    /* ignore */
  }
  return null;
}

export async function configureSync(payload: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch("/v1/sync/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchJson(url: string, options?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, options);
    if (res.ok) return await res.json();
  } catch {
    /* ignore */
  }
  return null;
}


// --- Dream Skin API ---

async function requestDreamSkin<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  if (!res.ok) {
    let errorBody: { error?: { type?: string; message?: string; details?: unknown } } | null = null;
    try {
      errorBody = await res.json();
    } catch {
      // non-JSON error
    }
    const err = new Error(errorBody?.error?.message || `Dream Skin request failed: ${res.status}`) as DreamSkinApiError;
    err.code = errorBody?.error?.type;
    err.details = errorBody?.error?.details as DreamSkinApiError["details"];
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function getDreamSkinCapabilities(): Promise<DreamSkinCapabilities> {
  return requestDreamSkin<DreamSkinCapabilities>("/v1/dream-skin/capabilities");
}

export function listDreamSkinThemes(): Promise<DreamSkinLibraryResponse> {
  return requestDreamSkin<DreamSkinLibraryResponse>("/v1/dream-skin/themes");
}

export function getDreamSkinTheme(id: string): Promise<{ theme: DreamSkinThemeDetail }> {
  return requestDreamSkin<{ theme: DreamSkinThemeDetail }>(
    `/v1/dream-skin/themes/${encodeURIComponent(id)}`,
  );
}

export function createDreamSkinTheme(input: DreamSkinThemeMutation): Promise<unknown> {
  return requestDreamSkin("/v1/dream-skin/themes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateDreamSkinTheme(id: string, input: DreamSkinThemeMutation): Promise<unknown> {
  return requestDreamSkin(`/v1/dream-skin/themes/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function duplicateDreamSkinTheme(id: string, input: { name?: string } = {}): Promise<unknown> {
  return requestDreamSkin(`/v1/dream-skin/themes/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function applyDreamSkinTheme(id: string): Promise<unknown> {
  return requestDreamSkin(`/v1/dream-skin/themes/${encodeURIComponent(id)}/apply`, {
    method: "POST",
  });
}

export function selectDreamSkinTheme(id: string): Promise<DreamSkinLibraryResponse> {
  return requestDreamSkin<DreamSkinLibraryResponse>(
    `/v1/dream-skin/themes/${encodeURIComponent(id)}/select`,
    { method: "POST" },
  );
}

export function deleteDreamSkinTheme(id: string): Promise<void> {
  return requestDreamSkin<void>(`/v1/dream-skin/themes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function importDreamSkinTheme(input: DreamSkinThemeMutation & { conflict?: string; requestedId?: string }): Promise<unknown> {
  return requestDreamSkin("/v1/dream-skin/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function loadDreamSkinMarket(forceRefresh = false): Promise<DreamSkinMarketResponse> {
  const path = forceRefresh
    ? "/v1/dream-skin/market/refresh"
    : "/v1/dream-skin/market";
  return requestDreamSkin<DreamSkinMarketResponse>(path, forceRefresh ? { method: "POST" } : undefined);
}

export function installDreamSkinMarketTheme(id: string): Promise<unknown> {
  return requestDreamSkin(`/v1/dream-skin/market/themes/${encodeURIComponent(id)}/install`, {
    method: "POST",
  });
}

export function updateDreamSkinMarketTheme(id: string): Promise<unknown> {
  return requestDreamSkin(`/v1/dream-skin/market/themes/${encodeURIComponent(id)}/update`, {
    method: "POST",
  });
}
