import { normalizeFramePolicy } from "../domain/schema.mjs";
import { OfficialRemoteLinkError } from "../domain/errors.mjs";

function readHeaders(res) {
  const raw = res?.headers || {};
  const get = typeof raw.get === "function"
    ? (name) => raw.get(name)
    : (name) => raw[name] ?? raw[name.toLowerCase()] ?? "";
  return {
    xFrameOptions: String(get("x-frame-options") || ""),
    contentSecurityPolicy: String(get("content-security-policy") || ""),
  };
}

export function createOfficialRemoteLinkService({
  store,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!store) throw new Error("store is required");

  function requireLink(id) {
    const link = store.get(id);
    if (!link) {
      throw new OfficialRemoteLinkError("link_not_found", "Official remote link not found: " + id);
    }
    return link;
  }

  return {
    async list() {
      return store.list();
    },
    async create(input = {}) {
      return store.create(input);
    },
    async update(id, input = {}) {
      const updated = store.update(id, input);
      if (!updated) {
        throw new OfficialRemoteLinkError("link_not_found", "Official remote link not found: " + id);
      }
      return updated;
    },
    async delete(id) {
      requireLink(id);
      return store.delete(id);
    },
    async checkFramePolicy(id) {
      const link = requireLink(id);
      let response;
      try {
        response = await fetchImpl(link.url, {
          method: "GET",
          redirect: "follow",
          headers: { accept: "text/html" },
        });
      } catch (error) {
        throw new OfficialRemoteLinkError(
          "frame_check_failed",
          "Unable to inspect Antigravity frame policy: " + (error?.message || String(error)),
        );
      }
      return {
        id: link.id,
        name: link.name,
        url: link.url,
        ...normalizeFramePolicy(readHeaders(response)),
      };
    },
  };
}
