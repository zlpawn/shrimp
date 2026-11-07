import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const CONFIG_DIR = path.join(os.homedir(), ".shrimp", "skills", "leo-craft-api");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/**
 * Reads the stored configuration or returns defaults.
 * @param {string} [customPath]
 * @returns {{ api_url: string, api_key: string, updated_at?: string }}
 */
export function loadConfig(customPath = CONFIG_FILE) {
  try {
    if (fs.existsSync(customPath)) {
      const raw = fs.readFileSync(customPath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        api_url: parsed.api_url || "",
        api_key: parsed.api_key || "",
        updated_at: parsed.updated_at
      };
    }
  } catch (err) {
    // If parse fails, return defaults
  }
  return {
    api_url: "",
    api_key: ""
  };
}

/**
 * Saves configuration to disk.
 * @param {object} updates
 * @param {string} [customPath]
 */
export function saveConfig(updates = {}, customPath = CONFIG_FILE) {
  const current = loadConfig(customPath);
  const next = {
    api_url: updates.api_url !== undefined ? updates.api_url : current.api_url,
    api_key: updates.api_key !== undefined ? updates.api_key : current.api_key,
    updated_at: new Date().toISOString()
  };

  const targetDir = path.dirname(customPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  fs.writeFileSync(customPath, JSON.stringify(next, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600
  });

  return next;
}

/**
 * Resolves active API config taking into account CLI flags and saved config.
 * Priority:
 * 1. Explicit options passed to constructor / call (--api-key, --api-url)
 * 2. Saved config (~/.shrimp/skills/leo-craft-api/config.json)
 * There is no default API URL: every Craft connection has its own endpoint.
 * (Environment variables like CRAFT_API_KEY are deliberately not used)
 */
export function resolveConfig(overrides = {}) {
  const fileConfig = loadConfig();
  const rawUrl = overrides.apiUrl || fileConfig.api_url || "";
  const rawKey = overrides.apiKey !== undefined ? overrides.apiKey : (fileConfig.api_key || "");

  const apiUrl = typeof rawUrl === "string" ? rawUrl.trim().replace(/\/+$/, "") : "";
  const apiKey = typeof rawKey === "string" ? rawKey.trim() : (rawKey ? String(rawKey).trim() : "");

  return {
    apiUrl,
    apiKey
  };
}

/**
 * Mask an API key for safe display.
 * @param {string} key
 * @returns {string}
 */
export function maskApiKey(key) {
  if (!key) return "(not set)";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/**
 * Craft API Client
 */
export class CraftClient {
  constructor(options = {}) {
    const resolved = resolveConfig(options);
    this.apiUrl = resolved.apiUrl;
    this.apiKey = resolved.apiKey;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  ensureAuth() {
    if (!this.apiUrl) {
      throw new Error(
        `Craft API URL is not set!\n` +
        `Copy the endpoint of your Craft API connection, then save it to ~/.shrimp/skills/leo-craft-api/config.json using:\n` +
        `  node scripts/craft-api.mjs config set --api-url https://connect.craft.do/links/<linkId>/api/v1\n` +
        `Or pass --api-url <URL> directly on the command line.`
      );
    }
    if (!this.apiKey) {
      throw new Error(
        `Craft API Key is not set!\n` +
        `Please set your API key in ~/.shrimp/skills/leo-craft-api/config.json using:\n` +
        `  node scripts/craft-api.mjs config set --api-key <YOUR_TOKEN>\n` +
        `Or pass --api-key <TOKEN> directly on the command line.`
      );
    }
  }

  /**
   * Core request runner with Bearer auth, timeout, and exponential backoff retry on 429.
   */
  async request(endpoint, options = {}) {
    this.ensureAuth();

    const {
      method = "GET",
      params,
      body,
      headers = {},
      rawBinary = false
    } = options;

    let urlStr = endpoint.startsWith("http://") || endpoint.startsWith("https://")
      ? endpoint
      : `${this.apiUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    if (params && Object.keys(params).length > 0) {
      const url = new URL(urlStr);
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          if (Array.isArray(v)) {
            for (const item of v) url.searchParams.append(k, item);
          } else {
            url.searchParams.set(k, String(v));
          }
        }
      }
      urlStr = url.toString();
    }

    const reqHeaders = {
      Authorization: `Bearer ${this.apiKey}`,
      ...headers
    };

    let reqBody = undefined;
    if (body !== undefined) {
      if (rawBinary) {
        reqBody = body;
      } else if (typeof body === "string") {
        reqBody = body;
        if (!reqHeaders["Content-Type"]) {
          reqHeaders["Content-Type"] = "application/json";
        }
      } else {
        reqBody = JSON.stringify(body);
        if (!reqHeaders["Content-Type"]) {
          reqHeaders["Content-Type"] = "application/json";
        }
      }
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(urlStr, {
          method,
          headers: reqHeaders,
          body: reqBody,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 429) {
          if (attempt > this.maxRetries) {
            const errText = await response.text();
            throw new Error(`HTTP 429 Rate Limit Exceeded after ${this.maxRetries} retries: ${errText}`);
          }
          const retryAfterHeader = response.headers.get("Retry-After");
          let waitMs = 2000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
          if (retryAfterHeader) {
            const parsedSec = parseFloat(retryAfterHeader);
            if (!Number.isNaN(parsedSec) && parsedSec > 0) {
              waitMs = Math.ceil(parsedSec * 1000);
            }
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        const contentType = response.headers.get("Content-Type") || "";
        const isJson = contentType.includes("application/json");

        if (!response.ok) {
          let errorDetail = "";
          try {
            if (isJson) {
              const errJson = await response.json();
              errorDetail = JSON.stringify(errJson);
            } else {
              errorDetail = await response.text();
            }
          } catch {
            errorDetail = response.statusText;
          }
          throw new Error(`Craft API Error ${response.status} (${response.statusText}) on ${method} ${urlStr}: ${errorDetail}`);
        }

        if (isJson) {
          return await response.json();
        } else {
          return await response.text();
        }
      } catch (err) {
        if (err.name === "AbortError") {
          throw new Error(`Craft API request timed out after ${this.timeoutMs}ms on ${method} ${urlStr}`);
        }
        if (attempt > this.maxRetries || !err.message.includes("429")) {
          throw err;
        }
      }
    }
  }

  // ================= Space & Connection Info =================
  async getConnectionInfo() {
    return this.request("/connection", { method: "GET" });
  }

  // ================= Folders =================
  async listFolders() {
    return this.request("/folders", { method: "GET" });
  }

  async createFolders(folders) {
    // folders: Array<{ name: string, parentFolderId?: string }>
    return this.request("/folders", {
      method: "POST",
      body: { folders: Array.isArray(folders) ? folders : [folders] }
    });
  }

  async deleteFolders(folderIds) {
    // folderIds: Array<string>
    return this.request("/folders", {
      method: "DELETE",
      body: { folderIds: Array.isArray(folderIds) ? folderIds : [folderIds] }
    });
  }

  async moveFolders(folderIds, destination) {
    // destination: "root" | { parentFolderId: string }
    const dest = destination === "root" ? "root" : (typeof destination === "string" ? { parentFolderId: destination } : destination);
    return this.request("/folders/move", {
      method: "PUT",
      body: {
        folderIds: Array.isArray(folderIds) ? folderIds : [folderIds],
        destination: dest
      }
    });
  }

  // ================= Documents =================
  async listDocuments(options = {}) {
    return this.request("/documents", {
      method: "GET",
      params: options
    });
  }

  async createDocuments(documents, destination) {
    // documents: Array<{ title: string, content?: any[] }>
    // destination: { folderId?: string, destination?: "unsorted" | "templates" }
    const body = {
      documents: Array.isArray(documents) ? documents : [documents]
    };
    if (destination) {
      if (typeof destination === "string") {
        if (destination === "unsorted" || destination === "templates") {
          body.destination = { destination };
        } else {
          body.destination = { folderId: destination };
        }
      } else {
        body.destination = destination;
      }
    }
    return this.request("/documents", {
      method: "POST",
      body
    });
  }

  async deleteDocuments(documentIds) {
    // documentIds: Array<string> (moves to trash)
    return this.request("/documents", {
      method: "DELETE",
      body: { documentIds: Array.isArray(documentIds) ? documentIds : [documentIds] }
    });
  }

  async moveDocuments(documentIds, destination) {
    // destination: { folderId?: string, destination?: "unsorted" | "templates" }
    let dest = destination;
    if (typeof destination === "string") {
      if (destination === "unsorted" || destination === "templates") {
        dest = { destination };
      } else {
        dest = { folderId: destination };
      }
    }
    return this.request("/documents/move", {
      method: "PUT",
      body: {
        documentIds: Array.isArray(documentIds) ? documentIds : [documentIds],
        destination: dest
      }
    });
  }

  async searchDocuments(options = {}) {
    return this.request("/documents/search", {
      method: "GET",
      params: options
    });
  }

  // ================= Blocks =================
  async getBlocks(options = {}) {
    // options: { id?: string, date?: string, maxDepth?: number, fetchMetadata?: boolean, format?: "json" | "markdown" }
    const { format = "json", ...params } = options;
    const accept = format === "markdown" ? "text/markdown" : "application/json";
    return this.request("/blocks", {
      method: "GET",
      params,
      headers: { Accept: accept }
    });
  }

  async insertBlocks(payload) {
    // payload: { blocks?: any[], markdown?: string, position: { position: "start"|"end"|"before"|"after", pageId?: string, date?: string, targetBlockId?: string } }
    return this.request("/blocks", {
      method: "POST",
      body: payload
    });
  }

  async updateBlocks(blocks) {
    // blocks: Array<{ id: string, markdown?: string, ... }>
    return this.request("/blocks", {
      method: "PUT",
      body: { blocks: Array.isArray(blocks) ? blocks : [blocks] }
    });
  }

  async deleteBlocks(blockIds) {
    // blockIds: Array<string>
    return this.request("/blocks", {
      method: "DELETE",
      body: { blockIds: Array.isArray(blockIds) ? blockIds : [blockIds] }
    });
  }

  async moveBlocks(blockIds, targetPosition) {
    // targetPosition: { position: "start"|"end"|"before"|"after", pageId?: string, date?: string, targetBlockId?: string }
    return this.request("/blocks/move", {
      method: "PUT",
      body: {
        blockIds: Array.isArray(blockIds) ? blockIds : [blockIds],
        position: targetPosition
      }
    });
  }

  async searchBlocks(options = {}) {
    // options: { id: string, query: string, ... }
    return this.request("/blocks/search", {
      method: "GET",
      params: options
    });
  }

  // ================= Tasks =================
  async listTasks(options = {}) {
    // options: { scope: "active"|"upcoming"|"inbox"|"logbook"|"document"|"all", documentId?: string }
    return this.request("/tasks", {
      method: "GET",
      params: options
    });
  }

  async addTasks(tasks) {
    // tasks: Array<{ markdown: string, date?: string, time?: string, taskListId?: string, ... }>
    return this.request("/tasks", {
      method: "POST",
      body: { tasks: Array.isArray(tasks) ? tasks : [tasks] }
    });
  }

  async updateTasks(tasks) {
    // tasks: Array<{ id: string, taskInfo?: { state?: "todo"|"done"|"cancelled" }, markdown?: string, ... }>
    return this.request("/tasks", {
      method: "PUT",
      body: { tasks: Array.isArray(tasks) ? tasks : [tasks] }
    });
  }

  async deleteTasks(taskIds) {
    // taskIds: Array<string>
    return this.request("/tasks", {
      method: "DELETE",
      body: { taskIds: Array.isArray(taskIds) ? taskIds : [taskIds] }
    });
  }

  // ================= Collections =================
  async listCollections(options = {}) {
    return this.request("/collections", {
      method: "GET",
      params: options
    });
  }

  async createCollection(payload) {
    return this.request("/collections", {
      method: "POST",
      body: payload
    });
  }

  async getCollectionItems(collectionId, options = {}) {
    return this.request(`/collections/${collectionId}/items`, {
      method: "GET",
      params: options
    });
  }

  async addCollectionItems(collectionId, items) {
    return this.request(`/collections/${collectionId}/items`, {
      method: "POST",
      body: { items: Array.isArray(items) ? items : [items] }
    });
  }

  async updateCollectionItems(collectionId, items) {
    return this.request(`/collections/${collectionId}/items`, {
      method: "PUT",
      body: { items: Array.isArray(items) ? items : [items] }
    });
  }

  async deleteCollectionItems(collectionId, itemIds) {
    return this.request(`/collections/${collectionId}/items`, {
      method: "DELETE",
      body: { itemIds: Array.isArray(itemIds) ? itemIds : [itemIds] }
    });
  }

  async getCollectionSchema(collectionId) {
    return this.request(`/collections/${collectionId}/schema`, { method: "GET" });
  }

  async updateCollectionSchema(collectionId, schema) {
    return this.request(`/collections/${collectionId}/schema`, {
      method: "PUT",
      body: schema
    });
  }

  async listCollectionViews(collectionId) {
    return this.request(`/collections/${collectionId}/views`, { method: "GET" });
  }

  async createCollectionView(collectionId, view) {
    return this.request(`/collections/${collectionId}/views`, {
      method: "POST",
      body: view
    });
  }

  async updateCollectionView(collectionId, viewId, view) {
    return this.request(`/collections/${collectionId}/views/${viewId}`, {
      method: "PUT",
      body: view
    });
  }

  async deleteCollectionView(collectionId, viewId) {
    return this.request(`/collections/${collectionId}/views/${viewId}`, {
      method: "DELETE"
    });
  }

  async setActiveCollectionView(collectionId, viewId) {
    return this.request(`/collections/${collectionId}/active-view`, {
      method: "PUT",
      body: { viewId }
    });
  }

  // ================= File Upload =================
  async uploadFile(filePath, options = {}) {
    // options: { position: "start"|"end"|"before"|"after", pageId?: string, date?: string, siblingId?: string, fileName?: string }
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stat = fs.statSync(resolvedPath);
    const data = fs.readFileSync(resolvedPath);
    const fileName = options.fileName || path.basename(resolvedPath);

    // Determine basic mime type
    const ext = path.extname(filePath).toLowerCase();
    let mime = "application/octet-stream";
    if (ext === ".png") mime = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
    else if (ext === ".gif") mime = "image/gif";
    else if (ext === ".webp") mime = "image/webp";
    else if (ext === ".svg") mime = "image/svg+xml";
    else if (ext === ".pdf") mime = "application/pdf";
    else if (ext === ".mp4") mime = "video/mp4";
    else if (ext === ".mov") mime = "video/quicktime";
    else if (ext === ".mp3") mime = "audio/mpeg";

    const { position = "end", pageId, date, siblingId } = options;
    const params = { position, fileName };
    if (pageId) params.pageId = pageId;
    if (date) params.date = date;
    if (siblingId) params.siblingId = siblingId;

    return this.request("/upload", {
      method: "POST",
      params,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size)
      },
      body: data,
      rawBinary: true
    });
  }

  // ================= Internal Links =================
  async listInternalLinks(options = {}) {
    return this.request("/internal-links", {
      method: "GET",
      params: options
    });
  }

  // ================= Reminders =================
  async listReminders(options = {}) {
    return this.request("/reminders", {
      method: "GET",
      params: options
    });
  }

  async createReminders(reminders) {
    return this.request("/reminders", {
      method: "POST",
      body: { reminders: Array.isArray(reminders) ? reminders : [reminders] }
    });
  }

  async updateReminders(reminders) {
    return this.request("/reminders", {
      method: "PUT",
      body: { reminders: Array.isArray(reminders) ? reminders : [reminders] }
    });
  }

  async deleteReminders(reminderIds) {
    return this.request("/reminders", {
      method: "DELETE",
      body: { reminderIds: Array.isArray(reminderIds) ? reminderIds : [reminderIds] }
    });
  }

  // ================= Comments =================
  async addComments(comments) {
    return this.request("/comments", {
      method: "POST",
      body: { comments: Array.isArray(comments) ? comments : [comments] }
    });
  }

  // ================= Whiteboards =================
  async createWhiteboard(payload) {
    return this.request("/whiteboards", {
      method: "POST",
      body: payload
    });
  }

  async getWhiteboardElements(whiteboardBlockId) {
    return this.request(`/whiteboards/${whiteboardBlockId}/elements`, { method: "GET" });
  }

  async addWhiteboardElements(whiteboardBlockId, elements) {
    return this.request(`/whiteboards/${whiteboardBlockId}/elements`, {
      method: "POST",
      body: { elements: Array.isArray(elements) ? elements : [elements] }
    });
  }

  async updateWhiteboardElements(whiteboardBlockId, elements) {
    return this.request(`/whiteboards/${whiteboardBlockId}/elements`, {
      method: "PUT",
      body: { elements: Array.isArray(elements) ? elements : [elements] }
    });
  }

  async deleteWhiteboardElements(whiteboardBlockId, elementIds) {
    return this.request(`/whiteboards/${whiteboardBlockId}/elements`, {
      method: "DELETE",
      body: { elementIds: Array.isArray(elementIds) ? elementIds : [elementIds] }
    });
  }
}
