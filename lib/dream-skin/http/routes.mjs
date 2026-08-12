/**
 * Dream Skin HTTP router and body parser.
 */

import { DreamSkinError } from "../domain/errors.mjs";

const STATUS_BY_CODE = {
  invalid_request: 400,
  invalid_theme: 400,
  invalid_theme_id: 400,
  invalid_image: 400,
  payload_too_large: 413,
  theme_not_found: 404,
  theme_already_exists: 409,
  theme_in_use: 409,
  builtin_theme_readonly: 409,
  market_unavailable: 503,
  market_manifest_invalid: 502,
  market_asset_invalid: 502,
  hash_mismatch: 502,
  unsupported_feature: 501,
  storage_error: 500,
};

const JSON_MAX_BYTES = 1 * 1024 * 1024;
const IMPORT_MAX_BYTES = 24 * 1024 * 1024;

export function sendDreamSkinError(res, error) {
  const status = STATUS_BY_CODE[error.code] || 500;
  const body = {
    error: {
      type: error.code,
      message: error.message,
    },
  };
  if (error.details && error.details.length > 0) {
    body.error.details = error.details;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function readJsonBody(req, { maxBytes = JSON_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new DreamSkinError("payload_too_large", `\u8BF7\u6C42\u4F53\u8D85\u8FC7 $glm_5.2_ark_toC \u5B57\u8282\u9650\u5236\u3002`));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(buffer.toString("utf8")));
      } catch {
        reject(new DreamSkinError("invalid_request", "\u8BF7\u6C42\u4F53\u4E0D\u662F\u6709\u6548 JSON\u3002"));
      }
    });

    req.on("error", (error) => {
      reject(new DreamSkinError("invalid_request", error.message));
    });
  });
}

function decodeImageUpload(imageObj) {
  if (!imageObj || typeof imageObj !== "object") return null;
  const name = imageObj.name;
  const dataBase64 = imageObj.dataBase64;
  if (typeof name !== "string" || typeof dataBase64 !== "string") return null;
  const bytes = Buffer.from(dataBase64, "base64");
  return { name, bytes };
}

export async function routeDreamSkinRequest(req, res, context, reqPath, { service }) {
  const method = req.method;
  const pathParts = reqPath.split("/").filter(Boolean); // ["v1", "dream-skin", ...]

  try {
    // GET /v1/dream-skin/capabilities
    if (method === "GET" && pathParts[2] === "capabilities") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(service.getCapabilities()));
      return;
    }

    // GET /v1/dream-skin/themes
    if (method === "GET" && pathParts[2] === "themes" && pathParts.length === 3) {
      const list = await service.listThemes();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
      return;
    }

    // GET /v1/dream-skin/themes/:id
    if (method === "GET" && pathParts[2] === "themes" && pathParts.length === 4) {
      const id = decodeURIComponent(pathParts[3]);
      const detail = await service.getTheme(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ theme: detail.theme }));
      return;
    }

    // GET /v1/dream-skin/themes/:id/image
    if (method === "GET" && pathParts[2] === "themes" && pathParts.length === 5 && pathParts[4] === "image") {
      const id = decodeURIComponent(pathParts[3]);
      const img = await service.getThemeImage(id);
      res.writeHead(200, {
        "Content-Type": img.mime,
        "Content-Length": img.bytes.length,
        "Cache-Control": "private, max-age=300",
      });
      res.end(img.bytes);
      return;
    }

    // POST /v1/dream-skin/themes
    if (method === "POST" && pathParts[2] === "themes" && pathParts.length === 3) {
      const body = await readJsonBody(req);
      const image = decodeImageUpload(body.image);
      if (!image) {
        throw new DreamSkinError("invalid_image", "\u521B\u5EFA\u4E3B\u9898\u9700\u8981\u80CC\u666F\u56FE\u7247\u3002");
      }
      const summary = await service.createTheme({ theme: body.theme, imageBytes: image.bytes });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // PUT /v1/dream-skin/themes/:id
    if (method === "PUT" && pathParts[2] === "themes" && pathParts.length === 4) {
      const id = decodeURIComponent(pathParts[3]);
      const body = await readJsonBody(req);
      const image = body.image ? decodeImageUpload(body.image) : null;
      const summary = await service.updateTheme(id, {
        theme: body.theme,
        imageBytes: image ? image.bytes : undefined,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // POST /v1/dream-skin/themes/:id/duplicate
    if (method === "POST" && pathParts[2] === "themes" && pathParts.length === 5 && pathParts[4] === "duplicate") {
      const id = decodeURIComponent(pathParts[3]);
      const body = await readJsonBody(req);
      const image = body.image ? decodeImageUpload(body.image) : null;
      const summary = await service.duplicateTheme(id, {
        name: body.name,
        imageBytes: image ? image.bytes : undefined,
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // POST /v1/dream-skin/themes/:id/select
    if (method === "POST" && pathParts[2] === "themes" && pathParts.length === 5 && pathParts[4] === "select") {
      const id = decodeURIComponent(pathParts[3]);
      const result = await service.selectTheme(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // DELETE /v1/dream-skin/themes/:id
    if (method === "DELETE" && pathParts[2] === "themes" && pathParts.length === 4) {
      const id = decodeURIComponent(pathParts[3]);
      await service.deleteTheme(id);
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /v1/dream-skin/import
    if (method === "POST" && pathParts[2] === "import") {
      const body = await readJsonBody(req, { maxBytes: IMPORT_MAX_BYTES });
      const image = decodeImageUpload(body.image);
      if (!image) {
        throw new DreamSkinError("invalid_image", "\u5BFC\u5165\u4E3B\u9898\u9700\u8981\u80CC\u666F\u56FE\u7247\u3002");
      }
      const summary = await service.importTheme({
        theme: body.theme,
        imageBytes: image.bytes,
        conflict: body.conflict || "error",
        requestedId: body.requestedId,
      });
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // GET /v1/dream-skin/market
    if (method === "GET" && pathParts[2] === "market" && pathParts.length === 3) {
      const result = await service.loadMarket();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // POST /v1/dream-skin/market/refresh
    if (method === "POST" && pathParts[2] === "market" && pathParts.length === 4 && pathParts[3] === "refresh") {
      const result = await service.loadMarket({ forceRefresh: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    // GET /v1/dream-skin/market/themes/:id/preview
    if (method === "GET" && pathParts[2] === "market" && pathParts[3] === "themes" && pathParts.length === 6 && pathParts[5] === "preview") {
      const id = decodeURIComponent(pathParts[4]);
      const preview = await service.getMarketPreview(id);
      res.writeHead(200, {
        "Content-Type": preview.mime,
        "Content-Length": preview.bytes.length,
        "Cache-Control": "private, max-age=300",
        "ETag": preview.etag,
      });
      res.end(preview.bytes);
      return;
    }

    // POST /v1/dream-skin/market/themes/:id/install
    if (method === "POST" && pathParts[2] === "market" && pathParts[3] === "themes" && pathParts.length === 6 && pathParts[5] === "install") {
      const id = decodeURIComponent(pathParts[4]);
      const summary = await service.installMarketTheme(id);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // POST /v1/dream-skin/market/themes/:id/update
    if (method === "POST" && pathParts[2] === "market" && pathParts[3] === "themes" && pathParts.length === 6 && pathParts[5] === "update") {
      const id = decodeURIComponent(pathParts[4]);
      const summary = await service.updateMarketTheme(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
      return;
    }

    // Forbidden routes return 404
    const forbidden = ["apply", "launch", "inject", "runtime", "community", "packages"];
    if (forbidden.includes(pathParts[2])) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "not_found", message: "Not found" } }));
      return;
    }

    // Catch-all 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { type: "not_found", message: "Not found" } }));
  } catch (error) {
    if (error instanceof DreamSkinError) {
      sendDreamSkinError(res, error);
    } else {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { type: "storage_error", message: error.message } }));
    }
  }
}