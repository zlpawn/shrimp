import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_CRAFT_FALLBACK_URL = "https://mcp.craft.do/links/GaXJmJAdyNg/mcp";

export function resolveCraftMcpUrl(config = {}) {
  // 1. Explicit config
  if (config.craft_mcp_url) return String(config.craft_mcp_url).trim();
  if (config.knowledge_base?.craft_mcp_url) return String(config.knowledge_base.craft_mcp_url).trim();

  // 2. Environment variable
  if (process.env.CRAFT_MCP_URL) return String(process.env.CRAFT_MCP_URL).trim();

  // 3. User gemini mcp_config.json auto-discovery
  try {
    const mcpConfigPath = path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
    if (fs.existsSync(mcpConfigPath)) {
      const parsed = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
      const craftServer = parsed.mcpServers?.craft;
      if (craftServer?.url) return craftServer.url.trim();
      if (craftServer?.serverUrl) return craftServer.serverUrl.trim();
    }
  } catch {
    // Ignore fallback errors
  }

  return DEFAULT_CRAFT_FALLBACK_URL;
}

export function parseSseJsonRpc(text) {
  if (typeof text !== "string") return text;
  const trimmed = text.trim();

  // Check for SSE format (data: {...})
  if (trimmed.includes("data:")) {
    const lines = trimmed.split("\n");
    for (const line of lines) {
      const match = line.match(/^data:\s*(.+)$/);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch {
          // Continue to next line if parse fails
        }
      }
    }
  }

  // Fallback to standard JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    return { error: { message: trimmed } };
  }
}

export function parseCraftDocumentList(rawText) {
  const documents = [];
  let nextCursor = null;

  const lines = rawText.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const nextMatch = trimmed.match(/documents list --cursor\s+([^\s]+)/i);
    if (nextMatch) {
      nextCursor = nextMatch[1];
      continue;
    }

    const docMatch = trimmed.match(/^<([a-zA-Z0-9_-]+)>\s*(.+)$/);
    if (docMatch) {
      documents.push({
        id: docMatch[1],
        title: docMatch[2].trim(),
      });
    }
  }

  return { documents, nextCursor };
}

export function parseCraftSearchResults(rawText) {
  const documents = [];
  const entries = rawText.split(/(?=\d+\)\s*Document\s*<)/g);

  for (const entry of entries) {
    const idMatch = entry.match(/Document\s*<([a-zA-Z0-9_-]+)>/);
    if (!idMatch) continue;

    const id = idMatch[1];
    let snippet = "";
    let title = "";

    const matchBlock = entry.match(/Match:\s*\n([\s\S]*?)(?=\n\s*(?:Created:|Modified:|$))/);
    if (matchBlock) {
      const snippetLines = matchBlock[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (snippetLines.length > 0) {
        // The first bold phrase or non-empty line often represents the title or heading
        title = snippetLines[0].replace(/\*\*/g, "").trim();
        snippet = snippetLines.slice(0, 3).join(" ");
      }
    }

    documents.push({
      id,
      title: title || id,
      snippet: snippet || title,
    });
  }

  return { documents, nextCursor: null };
}

export function parseCraftMarkdownPage(rawText) {
  let title = "未命名 Craft 笔记";
  let markdown = rawText;

  const titleMatch = rawText.match(/<pageTitle>([\s\S]*?)<\/pageTitle>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  const contentMatch = rawText.match(/<content>([\s\S]*?)<\/content>/i);
  if (contentMatch) {
    markdown = contentMatch[1].trim();
  } else {
    // Strip <page ...> and </page>
    markdown = rawText.replace(/<page[^>]*>/gi, "").replace(/<\/page>/gi, "").trim();
  }

  // Clean custom Craft highlight tags: <highlight color="...">text</highlight> -> **text**
  markdown = markdown.replace(/<highlight[^>]*>([\s\S]*?)<\/highlight>/gi, "**$1**");

  return { title, markdown };
}

export function createCraftChannel({
  mcpUrl = DEFAULT_CRAFT_FALLBACK_URL,
  fetchImpl = fetch,
  proxyAgent = null,
} = {}) {
  let cachedSpace = null;

  async function callTool(name, args = {}) {
    const payload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };

    const res = await fetchImpl(mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Craft MCP HTTP ${res.status}: ${errText}`);
    }

    const raw = await res.text();
    const data = parseSseJsonRpc(raw);

    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }

    const content = data.result?.content || [];
    const textItem = content.find((c) => c.type === "text");
    return textItem ? textItem.text : "";
  }

  async function getStatus() {
    try {
      const raw = await callTool("craft_read", { command: "connection info" });
      let parsed = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        // raw might be string representation
      }

      cachedSpace = {
        id: parsed.space?.id || "",
        name: parsed.space?.name || "Craft 个人空间",
        timezone: parsed.space?.timezone || "",
        urlTemplate: parsed.urlTemplates?.app || "",
      };

      return {
        connected: true,
        spaceId: cachedSpace.id,
        spaceName: cachedSpace.name,
        timezone: cachedSpace.timezone,
        urlTemplate: cachedSpace.urlTemplate,
        mcpUrl,
      };
    } catch (err) {
      return {
        connected: false,
        error: err.message,
        mcpUrl,
      };
    }
  }

  async function listDocuments({ cursor = "", limit = 50, search = "" } = {}) {
    if (search && search.trim()) {
      const raw = await callTool("craft_read", {
        command: `search ${search.trim()}`,
      });
      return parseCraftSearchResults(raw);
    }

    const cmd = cursor ? `documents list --cursor ${cursor}` : "documents list";
    const raw = await callTool("craft_read", { command: cmd });
    return parseCraftDocumentList(raw);
  }

  async function fetchDocument(rootBlockId) {
    const raw = await callTool("craft_read", {
      command: `blocks get ${rootBlockId} --format markdown`,
    });
    const parsed = parseCraftMarkdownPage(raw);
    return {
      rootBlockId,
      title: parsed.title,
      markdown: parsed.markdown,
    };
  }

  function buildCraftUrl(rootBlockId, spaceId = null) {
    const effectiveSpaceId = spaceId || cachedSpace?.id || "";
    if (effectiveSpaceId) {
      return `craftdocs://open?spaceId=${effectiveSpaceId}&blockId=${rootBlockId}`;
    }
    return `craftdocs://open?blockId=${rootBlockId}`;
  }

  return {
    mcpUrl,
    callTool,
    getStatus,
    listDocuments,
    fetchDocument,
    buildCraftUrl,
  };
}
