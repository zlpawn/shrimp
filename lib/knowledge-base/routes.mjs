import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { transcribeImageWithVisionLLM } from "./vision-transcriber.mjs";
import { detectGalleryDl } from "./gallery-dl.mjs";

export function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    if (process.platform === "win32") {
      spawn("rundll32", ["url.dll,FileProtocolHandler", target], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return true;
    }
    if (process.platform === "darwin") {
      spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
    spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch (err) {
    console.warn(`[kb] openExternalUrl error: ${err.message}`);
    return false;
  }
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(json);
}

function readBodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createKbRoutes({ store, pipeline, registry, dataDir, taskQueue = null, craftChannel = null, compiler = null, channelSecrets = null, wereadChannel = null, syncHistory = null, syncScheduler = null }) {
  const activeInstallTasks = new Map();

  return async function handleKbRequest(req, res, reqUrl, reqPath) {
    if (!reqPath.startsWith("/v1/kb")) {
      return false;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return true;
    }

    // GET /v1/kb/tools/status
    if (reqPath === "/v1/kb/tools/status" && req.method === "GET") {
      try {
        const statuses = await registry.detectAll();
        const galleryDl = detectGalleryDl();
        sendJson(res, 200, {
          tools: {
            ...statuses,
            gallery_dl: {
              available: !!galleryDl,
              version: galleryDl?.version || null,
              path: galleryDl?.path || null,
            },
          },
        });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/tools/install
    if (reqPath === "/v1/kb/tools/install" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const toolId = body.tool;
        if (!toolId) {
          sendJson(res, 400, { error: "Missing 'tool' parameter" });
          return true;
        }
        const taskId = `task_install_${Date.now()}`;
        const taskInfo = {
          taskId,
          tool: toolId,
          status: "running",
          progress: 10,
          logs: [`开始安装 ${toolId}...`],
        };
        activeInstallTasks.set(taskId, taskInfo);

        // Async execution
        (async () => {
          try {
            await registry.install(toolId, (line) => {
              taskInfo.logs.push(line);
              taskInfo.progress = Math.min(95, taskInfo.progress + 5);
            });
            taskInfo.status = "succeeded";
            taskInfo.progress = 100;
            taskInfo.logs.push(`安装 ${toolId} 完成!`);
          } catch (err) {
            taskInfo.status = "failed";
            taskInfo.error = err.message;
            taskInfo.logs.push(`安装失败: ${err.message}`);
          }
        })();

        sendJson(res, 200, { taskId, status: "running" });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/tools/upgrade
    if (reqPath === "/v1/kb/tools/upgrade" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const toolId = body.tool;
        if (!toolId) {
          sendJson(res, 400, { error: "Missing 'tool' parameter" });
          return true;
        }
        const taskId = `task_upgrade_${Date.now()}`;
        const taskInfo = {
          taskId,
          tool: toolId,
          status: "running",
          progress: 10,
          logs: [`检查并更新 ${toolId}...`],
        };
        activeInstallTasks.set(taskId, taskInfo);

        (async () => {
          try {
            await registry.upgrade(toolId, (line) => {
              taskInfo.logs.push(line);
              taskInfo.progress = Math.min(95, taskInfo.progress + 5);
            });
            taskInfo.status = "succeeded";
            taskInfo.progress = 100;
            taskInfo.logs.push(`更新 ${toolId} 完成!`);
          } catch (err) {
            taskInfo.status = "failed";
            taskInfo.error = err.message;
            taskInfo.logs.push(`更新失败: ${err.message}`);
          }
        })();

        sendJson(res, 200, { taskId, status: "running" });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /v1/kb/tasks/:id
    if (reqPath.startsWith("/v1/kb/tasks/") && req.method === "GET") {
      const taskId = reqPath.slice("/v1/kb/tasks/".length);
      const task = activeInstallTasks.get(taskId);
      if (!task) {
        sendJson(res, 404, { error: "Task not found" });
        return true;
      }
      sendJson(res, 200, task);
      return true;
    }

    // GET /v1/kb/collections
    if (reqPath === "/v1/kb/collections" && req.method === "GET") {
      const collections = store.listCollections();
      sendJson(res, 200, { collections });
      return true;
    }

    // POST /v1/kb/collections
    if (reqPath === "/v1/kb/collections" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const collection = store.createCollection(body);
        sendJson(res, 200, { collection });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return true;
    }

    // PUT /v1/kb/collections/:id
    if (reqPath.startsWith("/v1/kb/collections/") && req.method === "PUT") {
      const id = reqPath.slice("/v1/kb/collections/".length);
      try {
        const body = await readBodyJson(req);
        const collection = store.updateCollection(id, body);
        if (!collection) {
          sendJson(res, 404, { error: "Collection not found" });
          return true;
        }
        sendJson(res, 200, { collection });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return true;
    }

    // DELETE /v1/kb/collections/:id
    if (reqPath.startsWith("/v1/kb/collections/") && req.method === "DELETE") {
      const id = reqPath.slice("/v1/kb/collections/".length);
      if (id === "col_default") {
        sendJson(res, 400, { error: "默认知识库为系统保留目录，不允许删除" });
        return true;
      }
      store.deleteCollection(id);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // GET /v1/kb/documents
    if (reqPath === "/v1/kb/documents" && req.method === "GET") {
      const collectionId = reqUrl.searchParams.get("collection_id") || null;
      const docType = reqUrl.searchParams.get("doc_type") || null;
      const q = reqUrl.searchParams.get("q") || "";
      const limit = Number(reqUrl.searchParams.get("limit") || 50);
      const offset = Number(reqUrl.searchParams.get("offset") || 0);

      if (store.syncVideoKbDocs) {
        const mediaDir = path.resolve(dataDir, "..", "..");
        const filesDir = path.join(dataDir, "files");
        store.syncVideoKbDocs({ mediaDir, filesDir });
      }

      if (q.trim()) {
        const results = store.searchDocuments(q, limit);
        sendJson(res, 200, { documents: results, total: results.length });
      } else {
        const documents = store.listDocuments({ collection_id: collectionId, doc_type: docType, limit, offset });
        sendJson(res, 200, { documents, total: documents.length });
      }
      return true;
    }

    // GET /v1/kb/documents/:id
    if (reqPath.startsWith("/v1/kb/documents/") && req.method === "GET") {
      const id = reqPath.slice("/v1/kb/documents/".length);
      const doc = store.getDocument(id);
      if (!doc) {
        sendJson(res, 404, { error: "Document not found" });
        return true;
      }
      sendJson(res, 200, { document: doc });
      return true;
    }

    // POST /v1/kb/documents/:id/adopt
    if (reqPath.startsWith("/v1/kb/documents/") && reqPath.endsWith("/adopt") && req.method === "POST") {
      const parts = reqPath.split("/");
      const id = parts[4]; // /v1/kb/documents/:id/adopt
      try {
        const body = await readBodyJson(req);
        const doc = pipeline.adoptDocument(id, {
          engine: body.engine || "custom",
          content: body.content,
        });
        if (!doc) {
          sendJson(res, 404, { error: "Document not found" });
          return true;
        }
        sendJson(res, 200, { ok: true, document: doc });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/documents/:id/reparse
    if (reqPath.startsWith("/v1/kb/documents/") && reqPath.endsWith("/reparse") && req.method === "POST") {
      const parts = reqPath.split("/");
      const id = parts[4];
      try {
        const body = await readBodyJson(req);
        const document = await pipeline.reparseDocument(id, {
          engine: body.engine || "markitdown",
        });
        if (!document) {
          sendJson(res, 404, { error: "Document not found" });
          return true;
        }
        sendJson(res, 200, { ok: true, document });
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/documents/agent-prompt
    if (reqPath === "/v1/kb/documents/agent-prompt" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const result = pipeline.generateAgentPrompt({
          docIds: body.doc_ids || [],
          collectionId: body.collection_id || null,
        });
        sendJson(res, 200, { ok: true, promptText: result.promptText, items: result.items });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // DELETE /v1/kb/documents/:id
    if (reqPath.startsWith("/v1/kb/documents/") && req.method === "DELETE") {
      const id = reqPath.slice("/v1/kb/documents/".length);
      const ok = store.deleteDocument(id);
      sendJson(res, 200, { ok });
      return true;
    }

    // POST /v1/kb/ingest/image
    if (reqPath === "/v1/kb/ingest/image" && req.method === "POST") {
      try {
        const contentType = req.headers["content-type"] || "";
        let buffer;
        let originalFilename = "image.png";
        let title = "";
        let collectionId = "col_default";
        let client = "code";
        let endpointId = "";
        let model = "qwen-vl-max";

        if (contentType.includes("application/json")) {
          const body = await readBodyJson(req);
          if (body.url || body.image_url) {
            const doc = await pipeline.ingestImageUrl({
              url: (body.url || body.image_url).trim(),
              title: body.title || "",
              collectionId: body.collection_id || "col_default",
              client: body.client || "code",
              endpointId: body.endpoint_id || "",
              model: body.model || "qwen-vl-max",
            });
            sendJson(res, 200, { ok: true, document: doc });
            return true;
          } else if (body.image_base64) {
            const pureBase64 = body.image_base64.replace(/^data:image\/[a-z0-9.+]+;base64,/i, "");
            buffer = Buffer.from(pureBase64, "base64");
          } else if (body.image_path && fs.existsSync(body.image_path)) {
            buffer = fs.readFileSync(body.image_path);
            originalFilename = path.basename(body.image_path);
          } else {
            sendJson(res, 400, { error: "Missing 'url', 'image_base64', or valid 'image_path' in body" });
            return true;
          }
          originalFilename = body.original_filename || originalFilename;
          title = body.title || "";
          collectionId = body.collection_id || "col_default";
          client = body.client || "code";
          endpointId = body.endpoint_id || "";
          model = body.model || "qwen-vl-max";
        } else {
          originalFilename = decodeURIComponent(req.headers["x-filename"] || "image.png");
          title = decodeURIComponent(req.headers["x-title"] || "");
          collectionId = req.headers["x-collection-id"] || "col_default";
          client = req.headers["x-gateway-client"] || "code";
          endpointId = req.headers["x-gateway-endpoint"] || "";
          model = req.headers["x-gateway-model"] || "qwen-vl-max";
          buffer = await readBodyBuffer(req);
        }

        const doc = await pipeline.ingestImage({
          imageBuffer: buffer,
          originalFilename,
          title,
          collectionId,
          client,
          endpointId,
          model,
        });

        sendJson(res, 200, { ok: true, document: doc });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/ingest/image-url
    if (reqPath === "/v1/kb/ingest/image-url" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const url = (body.url || body.image_url || "").trim();
        if (!url) {
          sendJson(res, 400, { error: "Missing 'url' in body" });
          return true;
        }

        const doc = await pipeline.ingestImageUrl({
          url,
          title: body.title || "",
          collectionId: body.collection_id || "col_default",
          client: body.client || "code",
          endpointId: body.endpoint_id || "",
          model: body.model || "qwen-vl-max",
        });

        sendJson(res, 200, { ok: true, document: doc });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/ingest/text
    if (reqPath === "/v1/kb/ingest/text" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        if (!body.text) {
          sendJson(res, 400, { error: "Missing 'text' in body" });
          return true;
        }
        const doc = await pipeline.ingestText({
          text: body.text,
          title: body.title || (body.source_type === "video" ? "视频转录文档" : "纯文本草稿"),
          collectionId: body.collection_id || "col_default",
          sourceType: body.source_type || "text",
          sourceUrl: body.source_url || "",
        });
        sendJson(res, 200, { document: doc });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/ingest/url
    if (reqPath === "/v1/kb/ingest/url" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        if (!body.url) {
          sendJson(res, 400, { error: "Missing 'url' in body" });
          return true;
        }
        const doc = await pipeline.ingestUrl({
          url: body.url,
          collectionId: body.collection_id || "col_default",
          useLeo: Boolean(body.use_leo),
        });
        sendJson(res, 200, { document: doc });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/ingest/file
    if (reqPath === "/v1/kb/ingest/file" && req.method === "POST") {
      try {
        const filenameHeader = decodeURIComponent(req.headers["x-filename"] || "upload.dat");
        const collectionHeader = req.headers["x-collection-id"] || "col_default";

        // Read binary buffer
        const buffer = await readBodyBuffer(req);
        const tempFilePath = path.join(os.tmpdir(), `kb_up_${Date.now()}_${filenameHeader}`);
        fs.writeFileSync(tempFilePath, buffer);

        try {
          const doc = await pipeline.ingestFile({
            filePath: tempFilePath,
            originalFilename: filenameHeader,
            collectionId: collectionHeader,
          });
          sendJson(res, 200, { document: doc });
        } finally {
          if (fs.existsSync(tempFilePath)) {
            try {
              fs.unlinkSync(tempFilePath);
            } catch {
              // ignore
            }
          }
        }
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /v1/kb/files/:id/assets/:filename
    if (reqPath.startsWith("/v1/kb/files/") && reqPath.includes("/assets/") && req.method === "GET") {
      const match = reqPath.match(/^\/v1\/kb\/files\/([^/]+)\/assets\/(.+)$/);
      if (match) {
        const [, docId, assetName] = match;
        const assetPath = path.join(dataDir, "files", docId, "assets", assetName);
        if (fs.existsSync(assetPath)) {
          const ext = path.extname(assetName).toLowerCase();
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
          });
          fs.createReadStream(assetPath).pipe(res);
          return true;
        }
      }
      res.writeHead(404);
      res.end("Asset not found");
      return true;
    }

    // GET /v1/kb/channels/craft/status
    if (reqPath === "/v1/kb/channels/craft/status" && req.method === "GET") {
      if (!craftChannel) {
        sendJson(res, 503, { connected: false, error: "Craft 笔记渠道未启用或未配置" });
        return true;
      }
      try {
        const status = await craftChannel.getStatus();
        sendJson(res, 200, status);
      } catch (err) {
        sendJson(res, 500, { connected: false, error: err.message });
      }
      return true;
    }

    // GET /v1/kb/channels/craft/folders
    if (reqPath === "/v1/kb/channels/craft/folders" && req.method === "GET") {
      if (!craftChannel) {
        sendJson(res, 503, { error: "Craft 笔记渠道未启用" });
        return true;
      }
      try {
        const result = await craftChannel.listFolders();
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /v1/kb/channels/craft/documents
    if (reqPath === "/v1/kb/channels/craft/documents" && req.method === "GET") {
      if (!craftChannel) {
        sendJson(res, 503, { error: "Craft 笔记渠道未启用" });
        return true;
      }
      try {
        const q = reqUrl.searchParams.get("q") || "";
        const cursor = reqUrl.searchParams.get("cursor") || "";
        const limit = Number(reqUrl.searchParams.get("limit") || 50);
        const fetchAll = reqUrl.searchParams.get("all") !== "false";
        const filterEmpty = reqUrl.searchParams.get("filter_empty") !== "false";
        const folderId = reqUrl.searchParams.get("folder_id") || "";
        const location = reqUrl.searchParams.get("location") || "";
        const result = await craftChannel.listDocuments({ search: q, cursor, limit, fetchAll, filterEmpty, folderId, location });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/channels/craft/import
    if (reqPath === "/v1/kb/channels/craft/import" && req.method === "POST") {
      if (!craftChannel) {
        sendJson(res, 503, { error: "Craft 笔记渠道未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        if (!body.rootBlockId) {
          sendJson(res, 400, { error: "Missing 'rootBlockId' in body" });
          return true;
        }

        const note = await craftChannel.fetchDocument(body.rootBlockId);
        if (note.isEmpty) {
          sendJson(res, 400, { error: `笔记「${note.title || body.rootBlockId}」内容为空，已跳过导入` });
          return true;
        }
        const craftUrl = craftChannel.buildCraftUrl(body.rootBlockId);
        const collectionId = body.collection_id || "col_default";

        const doc = await pipeline.ingestCraftNote({
          rootBlockId: body.rootBlockId,
          title: body.title || note.title,
          markdown: note.markdown,
          collectionId,
          craftUrl,
        });

        sendJson(res, 200, { document: doc });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/channels/craft/batch-import
    if (reqPath === "/v1/kb/channels/craft/batch-import" && req.method === "POST") {
      if (!craftChannel) {
        sendJson(res, 503, { error: "Craft 笔记渠道未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length === 0) {
          sendJson(res, 400, { error: "Missing 'items' array in body" });
          return true;
        }

        const collectionId = body.collection_id || "col_default";
        const imported = [];
        const failed = [];

        for (const item of items) {
          const blockId = item.rootBlockId || item.id;
          if (!blockId) continue;
          try {
            const note = await craftChannel.fetchDocument(blockId);
            if (note.isEmpty) {
              failed.push({ rootBlockId: blockId, error: "笔记内容为空，已跳过" });
              continue;
            }
            const craftUrl = craftChannel.buildCraftUrl(blockId);
            const doc = await pipeline.ingestCraftNote({
              rootBlockId: blockId,
              title: item.title || note.title,
              markdown: note.markdown,
              collectionId,
              craftUrl,
            });
            imported.push(doc);
          } catch (err) {
            failed.push({ rootBlockId: blockId, error: err.message });
          }
        }

        sendJson(res, 200, { imported, failed, total: items.length });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /v1/kb/channels/config
    if (reqPath === "/v1/kb/channels/config" && req.method === "GET") {
      if (!channelSecrets) {
        sendJson(res, 200, { schedule: {}, channels: {} });
        return true;
      }
      const pubConfig = channelSecrets.getPublicConfig();
      const nextRun = syncScheduler ? syncScheduler.getNextRunInfo() : null;
      if (pubConfig.schedule && nextRun) {
        pubConfig.schedule.next_run_str = nextRun.time_str;
      }
      sendJson(res, 200, { ...pubConfig, next_run: nextRun });
      return true;
    }

    // POST /v1/kb/channels/config
    if (reqPath === "/v1/kb/channels/config" && req.method === "POST") {
      if (!channelSecrets) {
        sendJson(res, 503, { error: "渠道凭证管理未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        if (body.schedule && typeof body.schedule === "object") {
          channelSecrets.updateSchedule(body.schedule);
        }
        if (body.weread && typeof body.weread === "object") {
          channelSecrets.updateChannel("weread", body.weread);
          if (body.weread.credentials?.api_key && wereadChannel) {
            wereadChannel.setApiKey(channelSecrets.getChannelCredential("weread", "api_key"));
          }
        }
        if (body.craft && typeof body.craft === "object") {
          channelSecrets.updateChannel("craft", body.craft);
        }
        if (syncScheduler) {
          syncScheduler.restart();
        }
        const pubConfig = channelSecrets.getPublicConfig();
        const nextRun = syncScheduler ? syncScheduler.getNextRunInfo() : null;
        if (pubConfig.schedule && nextRun) {
          pubConfig.schedule.next_run_str = nextRun.time_str;
        }
        sendJson(res, 200, { ok: true, ...pubConfig, next_run: nextRun });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/channels/test
    if (reqPath === "/v1/kb/channels/test" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const channel = body.channel || "weread";
        if (channel === "weread") {
          const testKey = body.apiKey || (channelSecrets ? channelSecrets.getChannelCredential("weread", "api_key") : "");
          if (!testKey) {
            sendJson(res, 400, { connected: false, error: "未提供微信读书 API Key" });
            return true;
          }
          const { WereadChannel } = await import("./weread-channel.mjs");
          const tester = new WereadChannel({ apiKey: testKey });
          const status = await tester.getStatus();
          sendJson(res, 200, status);
          return true;
        }
        if (channel === "craft") {
          if (!craftChannel) {
            sendJson(res, 503, { connected: false, error: "Craft 渠道未配置" });
            return true;
          }
          const status = await craftChannel.getStatus();
          sendJson(res, 200, status);
          return true;
        }
        sendJson(res, 400, { error: `未知的测试渠道: ${channel}` });
      } catch (err) {
        sendJson(res, 500, { connected: false, error: err.message });
      }
      return true;
    }

    // GET /v1/kb/channels/weread/status
    if (reqPath === "/v1/kb/channels/weread/status" && req.method === "GET") {
      if (!wereadChannel) {
        sendJson(res, 503, { connected: false, error: "微信读书渠道未启用" });
        return true;
      }
      try {
        const key = channelSecrets ? channelSecrets.getChannelCredential("weread", "api_key") : "";
        if (key) wereadChannel.setApiKey(key);
        const status = await wereadChannel.getStatus();
        sendJson(res, 200, status);
      } catch (err) {
        sendJson(res, 500, { connected: false, error: err.message });
      }
      return true;
    }

    // GET /v1/kb/channels/weread/notebooks
    if (reqPath === "/v1/kb/channels/weread/notebooks" && req.method === "GET") {
      if (!wereadChannel) {
        sendJson(res, 503, { error: "微信读书渠道未启用" });
        return true;
      }
      try {
        const key = channelSecrets ? channelSecrets.getChannelCredential("weread", "api_key") : "";
        if (key) wereadChannel.setApiKey(key);
        const count = Number(reqUrl.searchParams.get("count") || 50);
        const lastSort = reqUrl.searchParams.get("lastSort") || null;
        const fetchAll = reqUrl.searchParams.get("all") === "true";
        const result = await wereadChannel.listNotebooks({ count, lastSort, fetchAll });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/channels/weread/import
    if (reqPath === "/v1/kb/channels/weread/import" && req.method === "POST") {
      if (!wereadChannel) {
        sendJson(res, 503, { error: "微信读书渠道未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        const bookId = body.bookId || body.book_id;
        if (!bookId) {
          sendJson(res, 400, { error: "缺少 bookId 参数" });
          return true;
        }
        const key = channelSecrets ? channelSecrets.getChannelCredential("weread", "api_key") : "";
        if (key) wereadChannel.setApiKey(key);

        const collectionId = body.collection_id || "col_default";
        const notesData = await wereadChannel.fetchBookNotes(bookId);
        const markdown = wereadChannel.formatBookMarkdown(notesData);

        const book = notesData.book || {};
        const title = body.title || book.title || "微信读书精读笔记";

        const doc = await pipeline.ingestWereadBookNotes({
          bookId,
          title: `《${title}》微信读书精读笔记`,
          author: book.author,
          cover: book.cover,
          readingProgress: book.readingProgress,
          category: book.category,
          collectionId,
          markdown,
          deepLink: book.deepLink || `https://weread.qq.com/web/reader/${bookId}`,
        });

        // Update watermark
        if (channelSecrets) {
          channelSecrets.setBookWatermark("weread", bookId, {
            last_sort: notesData.book?.sort || Date.now(),
            note_count: (notesData.bookmarks?.length || 0) + (notesData.reviews?.length || 0),
            title,
            doc_id: doc.id,
          });
        }

        sendJson(res, 200, { document: doc });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/channels/weread/batch-import
    if (reqPath === "/v1/kb/channels/weread/batch-import" && req.method === "POST") {
      if (!wereadChannel) {
        sendJson(res, 503, { error: "微信读书渠道未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        const bookIds = Array.isArray(body.bookIds) ? body.bookIds : (Array.isArray(body.items) ? body.items.map(i => i.bookId || i.id) : []);
        if (bookIds.length === 0) {
          sendJson(res, 400, { error: "缺少 bookIds 数组" });
          return true;
        }

        const key = channelSecrets ? channelSecrets.getChannelCredential("weread", "api_key") : "";
        if (key) wereadChannel.setApiKey(key);

        const collectionId = body.collection_id || "col_default";
        const imported = [];
        const failed = [];

        for (const bookId of bookIds) {
          try {
            const notesData = await wereadChannel.fetchBookNotes(bookId);
            const markdown = wereadChannel.formatBookMarkdown(notesData);
            const book = notesData.book || {};
            const title = book.title || "微信读书精读笔记";

            const doc = await pipeline.ingestWereadBookNotes({
              bookId,
              title: `《${title}》微信读书精读笔记`,
              author: book.author,
              cover: book.cover,
              readingProgress: book.readingProgress,
              category: book.category,
              collectionId,
              markdown,
              deepLink: book.deepLink || `https://weread.qq.com/web/reader/${bookId}`,
            });

            if (channelSecrets) {
              channelSecrets.setBookWatermark("weread", bookId, {
                last_sort: notesData.book?.sort || Date.now(),
                note_count: (notesData.bookmarks?.length || 0) + (notesData.reviews?.length || 0),
                title,
                doc_id: doc.id,
              });
            }

            imported.push(doc);
          } catch (err) {
            failed.push({ bookId, error: err.message });
          }
        }

        sendJson(res, 200, { imported, failed, total: bookIds.length });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/channels/sync (手动立即增量同步)
    if (reqPath === "/v1/kb/channels/sync" && req.method === "POST") {
      if (!syncScheduler) {
        sendJson(res, 503, { error: "增量同步调度器未启用" });
        return true;
      }
      try {
        const result = await syncScheduler.runSync({ trigger: "manual" });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // GET /v1/kb/channels/sync/history (获取同步流水与每日新增划线)
    if (reqPath === "/v1/kb/channels/sync/history" && req.method === "GET") {
      if (!syncHistory) {
        sendJson(res, 200, { history: [], daily_highlights: [] });
        return true;
      }
      try {
        const history = syncHistory.load(50);
        const dailyHighlights = syncHistory.getRecentHighlightsGroupedByDate(14);
        sendJson(res, 200, { history, daily_highlights: dailyHighlights });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // Helper to resolve documents for compilation
    function resolveDocumentsForCompile(body = {}) {
      const docIds = Array.isArray(body.document_ids) ? body.document_ids : [];
      if (docIds.length > 0) {
        return docIds.map((id) => store.getDocument(id)).filter(Boolean);
      }
      if (body.collection_id) {
        return store.listDocuments({ collection_id: body.collection_id, limit: 30 });
      }
      return [];
    }

    // GET /v1/kb/compile/models
    if (reqPath === "/v1/kb/compile/models" && req.method === "GET") {
      const models = compiler ? compiler.getModels() : [];
      sendJson(res, 200, { models });
      return true;
    }

    // POST /v1/kb/compile/preview
    if (reqPath === "/v1/kb/compile/preview" && req.method === "POST") {
      if (!compiler) {
        sendJson(res, 503, { error: "Karpathy 知识库编译器服务未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        const docs = resolveDocumentsForCompile(body);
        if (docs.length === 0) {
          sendJson(res, 400, { error: "没有找到待编译的文档材料，请先添加或选择文档" });
          return true;
        }
        const result = await compiler.compileDraft({
          documents: docs,
          vaultRoot: body.vault_root || "",
          client: body.client || "code",
          model: body.model || "",
          endpointId: body.endpoint_id || "",
          customInstruction: body.custom_instruction || "",
          engine: body.engine || "markitdown",
        });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/compile/refine
    if (reqPath === "/v1/kb/compile/refine" && req.method === "POST") {
      if (!compiler) {
        sendJson(res, 503, { error: "Karpathy 知识库编译器服务未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        if (!body.draft) {
          sendJson(res, 400, { error: "请求缺少待优化的编译草稿 (draft)" });
          return true;
        }
        if (!body.feedback || !String(body.feedback).trim()) {
          sendJson(res, 400, { error: "请输入具体的增量修改建议 (feedback)" });
          return true;
        }
        const docs = resolveDocumentsForCompile(body);
        const result = await compiler.refineDraft({
          draft: body.draft,
          feedback: String(body.feedback).trim(),
          documents: docs,
          vaultRoot: body.vault_root || "",
          client: body.client || "code",
          model: body.model || "",
          endpointId: body.endpoint_id || "",
        });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/compile/apply
    if (reqPath === "/v1/kb/compile/apply" && req.method === "POST") {
      if (!compiler) {
        sendJson(res, 503, { error: "Karpathy 知识库编译器服务未启用" });
        return true;
      }
      try {
        const body = await readBodyJson(req);
        if (!body.draft) {
          sendJson(res, 400, { error: "缺少待写入的草稿数据 (draft)" });
          return true;
        }
        const vaultRoot = String(body.vault_root || "").trim();
        if (!vaultRoot) {
          sendJson(res, 400, { error: "必须提供目标 Obsidian 知识库根目录绝对路径 (vault_root)" });
          return true;
        }
        const docs = resolveDocumentsForCompile(body);
        const result = compiler.applyDraftToVault({
          draft: body.draft,
          documents: docs,
          vaultRoot,
          kbDataDir: dataDir,
          engine: body.engine || "markitdown",
        });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/open-url (Launch desktop app or external URL via OS shell)
    if (reqPath === "/v1/kb/open-url" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const url = String(body.url || "").trim();
        if (!url) {
          sendJson(res, 400, { error: "缺少 url 参数" });
          return true;
        }
        const ok = openExternalUrl(url);
        sendJson(res, 200, { ok, url });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    // POST /v1/kb/vision/transcribe
    if (reqPath === "/v1/kb/vision/transcribe" && req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        let imagePath = body.image_path || body.imagePath || "";
        let assetUrl = body.asset_url || body.assetUrl || "";
        const docId = body.doc_id || body.docId || "";
        const assetName = body.asset_name || body.assetName || "";
        const sourceType = body.source_type || body.sourceType || "doc";
        const timestampOrPage = body.timestamp_or_page || body.timestampOrPage || "";
        const title = body.title || assetName || "图像凭证";

        if (!imagePath && docId && assetName) {
          const candidate1 = path.join(dataDir, "files", docId, "assets", assetName);
          const candidate2 = path.join(dataDir, "files", docId, assetName);
          if (fs.existsSync(candidate1)) {
            imagePath = candidate1;
          } else if (fs.existsSync(candidate2)) {
            imagePath = candidate2;
          }
          if (!assetUrl) {
            assetUrl = `/v1/kb/files/${encodeURIComponent(docId)}/assets/${encodeURIComponent(assetName)}`;
          }
        }

        if (!imagePath && !body.data_url && !body.dataUrl) {
          sendJson(res, 400, { error: "未找到指定的图片素材或缺少图像数据 (imagePath/dataUrl)" });
          return true;
        }

        const listenPort = Number(process.env.PORT || process.env.GATEWAY_PORT || 8788);
        const result = await transcribeImageWithVisionLLM({
          imagePath,
          dataUrl: body.data_url || body.dataUrl || "",
          assetUrl: assetUrl || (imagePath ? `assets/${path.basename(imagePath)}` : "assets/image.png"),
          filename: assetName || (imagePath ? path.basename(imagePath) : "image.png"),
          title,
          sourceType,
          timestampOrPage,
          client: body.client || "code",
          endpointId: body.endpoint_id || body.endpointId || "",
          model: body.model || "qwen-vl-max",
          listenPort,
        });

        // If user requested to attach card to document
        if (body.apply_to_doc && docId && store) {
          const doc = store.getDocument(docId);
          if (doc) {
            const targetEngine = body.engine || doc.adopted_engine || "docling";
            const currentMd = targetEngine === "markitdown" ? doc.markitdown_md : doc.docling_md;
            const updatedMd = `${currentMd || ""}\n\n${result.cardHtml}\n`;
            const updates = targetEngine === "markitdown"
              ? { markitdown_md: updatedMd }
              : { docling_md: updatedMd };
            store.updateDocumentResult(docId, updates);
            result.applied = true;
          }
        }

        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
      return true;
    }

    return false;
  };
}
