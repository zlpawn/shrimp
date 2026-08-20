import { createClipAnchorStore } from "./clip-anchors.mjs";
import { createMetaStore } from "./meta-store.mjs";

export async function routeClipAnchorRequest(req, res, { url, readText, sendJson, mediaDataDir }) {
  const reqPath = url.pathname;
  const { metaDbPath } = {
    metaDbPath: `${mediaDataDir()}/video-kb/meta.sqlite`,
  };
  const store = createClipAnchorStore({ dbPath: metaDbPath });
  const metaStore = createMetaStore({ dbPath: metaDbPath });
  const close = () => {
    try { store.close(); } catch { /* ignore */ }
    try { metaStore.close(); } catch { /* ignore */ }
  };

  try {
    const idMatch = reqPath.match(/^\/v1\/clip-anchors\/([^/]+)$/);
    if (reqPath === "/v1/clip-anchors" && req.method === "GET") {
      const collection = String(url.searchParams.get("collection") || "").trim();
      const objectType = String(url.searchParams.get("object_type") || "").trim();
      const objectId = String(url.searchParams.get("object_id") || "").trim();
      const confirmed = url.searchParams.get("confirmed");
      const forDisplay = ["1", "true", "yes"].includes(String(url.searchParams.get("for_display") || "").toLowerCase());
      const anchors = store.listAnchors({
        collection: collection || undefined,
        object_type: objectType || undefined,
        object_id: objectId || undefined,
        confirmed: confirmed === "1" ? 1 : undefined,
        for_display: forDisplay,
      }).map((anchor) => {
        const video = metaStore.getVideo(anchor.video_id);
        return { ...anchor, asset_missing: !video };
      });
      sendJson(res, 200, { anchors, count: anchors.length });
      return true;
    }

    if (reqPath === "/v1/clip-anchors" && req.method === "POST") {
      let body;
      try {
        body = JSON.parse(await readText(req) || "{}");
      } catch {
        sendJson(res, 400, { error: { type: "invalid_request_error", message: "Invalid JSON body." } });
        return true;
      }
      try {
        const anchor = store.upsertAnchor(body);
        sendJson(res, 200, { anchor });
      } catch (err) {
        sendJson(res, 400, { error: { type: "invalid_request_error", message: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    if (idMatch && req.method === "PATCH") {
      const id = decodeURIComponent(idMatch[1]);
      const existing = store.getAnchor(id);
      if (!existing) {
        sendJson(res, 404, { error: { type: "anchor_not_found", message: `Anchor not found: ${id}` } });
        return true;
      }
      let body;
      try {
        body = JSON.parse(await readText(req) || "{}");
      } catch {
        sendJson(res, 400, { error: { type: "invalid_request_error", message: "Invalid JSON body." } });
        return true;
      }
      try {
        const anchor = store.upsertAnchor({ ...existing, ...body, id });
        sendJson(res, 200, { anchor });
      } catch (err) {
        sendJson(res, 400, { error: { type: "invalid_request_error", message: err instanceof Error ? err.message : String(err) } });
      }
      return true;
    }

    if (idMatch && req.method === "DELETE") {
      const id = decodeURIComponent(idMatch[1]);
      const existing = store.getAnchor(id);
      if (!existing) {
        sendJson(res, 404, { error: { type: "anchor_not_found", message: `Anchor not found: ${id}` } });
        return true;
      }
      sendJson(res, 200, store.deleteAnchor(id));
      return true;
    }

    return false;
  } finally {
    close();
  }
}
