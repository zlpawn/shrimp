import { OfficialRemoteLinkError } from "./errors.mjs";

export const OFFICIAL_REMOTE_LINK_KIND = "antigravity";

export function normalizeOfficialRemoteLink(input = {}) {
  const name = String(input?.name || "").trim();
  const url = String(input?.url || "").trim();
  if (!name) {
    throw new OfficialRemoteLinkError("invalid_request", "Link name is required");
  }
  if (name.length > 80) {
    throw new OfficialRemoteLinkError("invalid_request", "Link name must be 80 characters or fewer");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new OfficialRemoteLinkError("invalid_request", "Official Antigravity link must use HTTPS");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "antigravity.google.com") {
    throw new OfficialRemoteLinkError(
      "invalid_request",
      "Official Antigravity link must be an HTTPS antigravity.google.com URL",
    );
  }

  return {
    id: String(input?.id || "").trim(),
    name,
    url: parsed.toString(),
    kind: OFFICIAL_REMOTE_LINK_KIND,
    createdAt: input?.createdAt || null,
    updatedAt: input?.updatedAt || null,
  };
}

export function normalizeFramePolicy(headers = {}) {
  const xFrameOptions = String(headers?.xFrameOptions || headers?.["x-frame-options"] || "").trim();
  const csp = String(headers?.contentSecurityPolicy || headers?.["content-security-policy"] || "").trim();
  const frameAncestorsMatch = csp.toLowerCase().match(/frame-ancestors([^;]*)/);
  const frameAncestors = frameAncestorsMatch ? frameAncestorsMatch[1].trim() : "";

  if (/^deny$/i.test(xFrameOptions)) {
    return { embeddable: false, reason: "x_frame_options_deny", xFrameOptions, frameAncestors };
  }
  if (/^sameorigin$/i.test(xFrameOptions)) {
    return { embeddable: false, reason: "x_frame_options_sameorigin", xFrameOptions, frameAncestors };
  }
  if (frameAncestors === "'none'") {
    return { embeddable: false, reason: "frame_ancestors_none", xFrameOptions, frameAncestors };
  }
  if (frameAncestors && !frameAncestors.includes("*")) {
    return { embeddable: false, reason: "frame_ancestors_restricted", xFrameOptions, frameAncestors };
  }
  return { embeddable: true, reason: "", xFrameOptions, frameAncestors };
}
