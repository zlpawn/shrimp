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

export function parseCraftFolderList(rawText) {
  const folders = [];
  let nextOffset = null;
  const stack = []; // [{ id, depth }]

  const lines = (rawText || "").split("\n");
  for (const line of lines) {
    const nextMatch = line.match(/Next page:\s*folders list\s+--offset\s+(\d+)/i);
    if (nextMatch) {
      nextOffset = Number(nextMatch[1]);
      continue;
    }

    const folderMatch = line.match(/^(\s*)(?:\*|-)?\s*<([a-zA-Z0-9_-]+)>\s*(.+?)(?:\s*\((\d+)\s*docs?\))?$/);
    if (folderMatch) {
      const indent = folderMatch[1] || "";
      const depth = Math.floor(indent.length / 2);
      const id = folderMatch[2];
      const name = folderMatch[3].trim();
      const docCount = folderMatch[4] ? Number(folderMatch[4]) : 0;

      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      const parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
      stack.push({ id, depth });

      folders.push({
        id,
        name,
        depth,
        docCount,
        parentId,
      });
    }
  }

  return { folders, nextOffset };
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

  async function listFolders({ maxPages = 10 } = {}) {
    let allFolders = [];
    let offset = 0;
    let page = 0;

    while (page < maxPages) {
      page++;
      const cmd = offset > 0 ? `folders list --offset ${offset}` : "folders list";
      const raw = await callTool("craft_read", { command: cmd });
      const parsed = parseCraftFolderList(raw);
      allFolders.push(...parsed.folders);

      if (parsed.nextOffset == null || parsed.nextOffset <= offset) {
        break;
      }
      offset = parsed.nextOffset;
    }

    // Merge and deduplicate by folder id, keeping the best parentId and highest docCount
    const folderMap = new Map();
    for (const f of allFolders) {
      if (!folderMap.has(f.id)) {
        folderMap.set(f.id, { ...f });
      } else {
        const existing = folderMap.get(f.id);
        if (!existing.parentId && f.parentId) existing.parentId = f.parentId;
        if (f.docCount > existing.docCount) existing.docCount = f.docCount;
      }
    }

    // Construct hierarchy: group children by parentId
    const roots = [];
    const childrenMap = new Map();
    for (const f of folderMap.values()) {
      if (!f.parentId || !folderMap.has(f.parentId)) {
        roots.push(f);
      } else {
        if (!childrenMap.has(f.parentId)) childrenMap.set(f.parentId, []);
        childrenMap.get(f.parentId).push(f);
      }
    }

    // Pre-order traversal so children appear directly under their parents with accurate depth
    const treeFolders = [];
    function traverse(f, depth = 0) {
      treeFolders.push({ ...f, depth });
      const children = childrenMap.get(f.id) || [];
      for (const child of children) {
        traverse(child, depth + 1);
      }
    }
    for (const r of roots) {
      traverse(r, 0);
    }

    return { folders: treeFolders };
  }

  async function listDocuments({ cursor = "", limit = 50, search = "", fetchAll = true, maxPages = 10, filterEmpty = true, folderId = "", location = "" } = {}) {
    if (search && search.trim()) {
      const locOpt = location ? ` --location ${location}` : "";
      const raw = await callTool("craft_read", {
        command: `search ${search.trim()}${locOpt}`,
      });
      const parsed = parseCraftSearchResults(raw);
      const docs = filterEmpty
        ? parsed.documents.filter((d) => {
            const t = (d.title || "").trim();
            return t && t !== "Untitled" && t !== "(Untitled)" && t !== "未命名" && t !== "无标题";
          })
        : parsed.documents;
      return { documents: docs, nextCursor: null };
    }

    let allDocs = [];
    let cur = cursor;
    let pageCount = 0;

    let baseCmd = "documents list";
    if (folderId) {
      baseCmd = `documents list --folder ${folderId}`;
    } else if (location) {
      baseCmd = `documents list --location ${location}`;
    }

    while (pageCount < maxPages) {
      pageCount++;
      const cmd = cur ? `${baseCmd} --cursor ${cur}` : baseCmd;
      const raw = await callTool("craft_read", { command: cmd });
      const parsed = parseCraftDocumentList(raw);
      allDocs.push(...parsed.documents);

      if (!parsed.nextCursor || !fetchAll) {
        cur = parsed.nextCursor;
        break;
      }
      cur = parsed.nextCursor;
    }

    if (filterEmpty) {
      allDocs = allDocs.filter((d) => {
        const t = (d.title || "").trim();
        return t && t !== "Untitled" && t !== "(Untitled)" && t !== "未命名" && t !== "无标题";
      });
    }

    return { documents: allDocs, nextCursor: cur };
  }

  async function ensureSpaceInfo() {
    if (!cachedSpace?.id) {
      try {
        await getStatus();
      } catch {
        // Ignore fallback errors
      }
    }
  }

  async function fetchDocument(rootBlockId) {
    await ensureSpaceInfo();
    const raw = await callTool("craft_read", {
      command: `blocks get ${rootBlockId} --format markdown`,
    });
    const parsed = parseCraftMarkdownPage(raw);
    const isEmpty = !parsed.markdown || !parsed.markdown.trim();
    return {
      rootBlockId,
      title: parsed.title,
      markdown: parsed.markdown,
      isEmpty,
    };
  }

  function buildCraftUrl(rootBlockId, spaceId = null) {
    const effectiveSpaceId = spaceId || cachedSpace?.id || "";
    if (effectiveSpaceId) {
      return `https://docs.craft.do/editor/d/${effectiveSpaceId}/${rootBlockId}`;
    }
    return `https://docs.craft.do/editor/d/_/${rootBlockId}`;
  }

  return {
    mcpUrl,
    callTool,
    getStatus,
    listFolders,
    listDocuments,
    fetchDocument,
    buildCraftUrl,
  };
}
