export interface AppConfig {
  server: { host: string; port: number };
  clients: Record<string, ClientConfig>;
  codex_model_catalog?: { path?: string; path_posix?: string };
  custom_prices?: CustomPrice[];
  [key: string]: unknown;
}

export interface ClientConfig {
  endpoints: Endpoint[];
  model_slots?: Record<string, string>;
  [key: string]: unknown;
}

export type KeyStrategy = "failover" | "round-robin" | "random";

export interface Credential {
  id: string;
  label?: string;
}

export interface Endpoint {
  id?: string;
  name: string;
  type: string;
  base_url: string;
  api_key?: string;
  models: string[];
  model_mapping?: Record<string, string>;
  is_default?: boolean;
  enabled?: boolean;
  purpose?: string;
  proxy?: string;
  api_keys?: Credential[];
  key_strategy?: KeyStrategy;
  api_key_values?: Record<string, string>;
  [key: string]: unknown;
}

export type ToolsView = "cards" | "embedding" | "classification-metrics"
  | "antigravity-subscribe" | "codex-subscribe"
  | "image-gen" | "video-gen" | "tts" | "video-kb";

export interface Selection {
  client: string;
  index: number;
}

export interface AnalyticsResponse {
  summary: Record<string, unknown>;
  timeline: unknown[];
  purpose_breakdown: unknown[];
  client_breakdown: unknown[];
  endpoint_breakdown: unknown[];
  model_breakdown: unknown[];
  detail_breakdown: unknown[];
  [key: string]: unknown;
}

export interface CustomPrice {
  model: string;
  currency: string;
  prompt: number;
  completion: number;
  cache_creation?: number;
  cache_read?: number;
}


// --- Dream Skin types ---

export interface DreamSkinCapabilities {
  packageImport: boolean;
  customCss: boolean;
  communityPublishing: boolean;
  codexRuntime: boolean;
}

export interface DreamSkinRuntimeStatus {
  available: boolean;
  codexRuntime: boolean;
  targets: unknown[];
}

export interface DreamSkinTheme {
  id: string;
  name: string;
  kind: "builtin" | "stored";
  builtin: boolean;
  selected: boolean;
  source: "builtin" | "local" | "market";
  version?: string | null;
  stylePreset: string;
  appearance: "auto" | "light" | "dark";
  imageUrl: string;
  updateAvailable?: boolean;
}

export interface DreamSkinThemeDetail {
  id: string;
  name: string;
  kind: "builtin" | "stored";
  builtin: boolean;
  stylePreset: string;
  appearance: "auto" | "light" | "dark";
  imageUrl: string;
  brandSubtitle: string;
  tagline: string;
  projectPrefix: string;
  projectLabel: string;
  statusText: string;
  quote: string;
  art: {
    focusX: number;
    focusY: number;
    safeArea: "auto" | "left" | "right" | "center" | "none";
    taskMode: "ambient" | "banner" | "off";
  };
  colors: Record<string, string>;
}

export interface DreamSkinLibraryResponse {
  selectedThemeId: string;
  themes: DreamSkinTheme[];
  invalidEntries: number;
  warnings: Array<{ code: string; message: string }>;
}

export interface DreamSkinMarketTheme {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
  sourceUrl: string;
  tags: string[];
  previewUrl: string;
  installed: boolean;
  installedVersion: string;
  updateAvailable: boolean;
}

export interface DreamSkinMarketResponse {
  themes: DreamSkinMarketTheme[];
  updatedAt: string;
  cached: boolean;
  warning: { code: string; message: string } | null;
}

export interface DreamSkinApiError extends Error {
  code?: string;
  details?: Array<{ field: string; code: string; message?: string }>;
}

export interface DreamSkinImageUpload {
  name: string;
  dataBase64: string;
}

export interface DreamSkinThemeMutation {
  theme: Record<string, unknown>;
  image?: DreamSkinImageUpload;
}

export type DreamSkinPreviewScene = "home" | "chat";
