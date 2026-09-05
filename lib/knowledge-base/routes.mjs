import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

export function createKbRoutes({ store, pipeline, registry, dataDir, taskQueue = null }) {
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
        sendJson(res, 200, { tools: statuses });
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
      const q = reqUrl.searchParams.get("q") || "";
      const limit = Number(reqUrl.searchParams.get("limit") || 50);
      const offset = Number(reqUrl.searchParams.get("offset") || 0);

      if (q.trim()) {
        const results = store.searchDocuments(q, limit);
        sendJson(res, 200, { documents: results, total: results.length });
      } else {
        const documents = store.listDocuments({ collection_id: collectionId, limit, offset });
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

    // DELETE /v1/kb/documents/:id
    if (reqPath.startsWith("/v1/kb/documents/") && req.method === "DELETE") {
      const id = reqPath.slice("/v1/kb/documents/".length);
      const ok = store.deleteDocument(id);
      sendJson(res, 200, { ok });
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
          title: body.title || "纯文本草稿",
          collectionId: body.collection_id || "col_default",
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

    return false;
  };
}
