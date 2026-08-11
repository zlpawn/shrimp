/**
 * Image format detection using magic bytes.
 */

import { DreamSkinError } from "./errors.mjs";

export const MAX_THEME_IMAGE_BYTES = 16 * 1024 * 1024; // 16 MiB

const SIGNATURES = [
  {
    extension: "png",
    mime: "image/png",
    test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    extension: "jpg",
    mime: "image/jpeg",
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    extension: "webp",
    mime: "image/webp",
    test: (b) => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    extension: "gif",
    mime: "image/gif",
    test: (b) => b.length >= 6 && ((b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && b[4] === 0x37 && b[5] === 0x61) || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && b[4] === 0x39 && b[5] === 0x61)),
  },
  {
    extension: "bmp",
    mime: "image/bmp",
    test: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d,
  },
];

export function inspectImage(bytes, { expectedName } = {}) {
  if (!bytes || !Buffer.isBuffer(bytes)) {
    throw new DreamSkinError("invalid_image", "\u56FE\u7247\u6570\u636E\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  if (bytes.length === 0) {
    throw new DreamSkinError("invalid_image", "\u56FE\u7247\u6587\u4EF6\u4E3A\u7A7A\u3002");
  }
  if (bytes.length > MAX_THEME_IMAGE_BYTES) {
    throw new DreamSkinError("invalid_image", `\u56FE\u7247\u6587\u4EF6\u8D85\u8FC7 ${Math.round(MAX_THEME_IMAGE_BYTES / 1024 / 1024)} MiB \u9650\u5236\u3002`);
  }

  // Reject SVG / XML / HTML
  const head = bytes.subarray(0, Math.min(bytes.length, 256)).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype html") || head.startsWith("<html")) {
    throw new DreamSkinError("invalid_image", "\u4E0D\u652F\u6301 SVG \u6216 HTML \u6587\u4EF6\u3002");
  }

  const sig = SIGNATURES.find((s) => s.test(bytes));
  if (!sig) {
    throw new DreamSkinError("invalid_image", "\u65E0\u6CD5\u8BC6\u522B\u56FE\u7247\u683C\u5F0F\u3002");
  }

  // Validate extension if expectedName is provided
  if (expectedName) {
    assertImageNameMatchesFormat(expectedName, sig);
  }

  return {
    extension: sig.extension,
    mime: sig.mime,
    size: bytes.length,
  };
}

export function assertImageNameMatchesFormat(name, format) {
  if (typeof name !== "string" || name.length === 0) {
    throw new DreamSkinError("invalid_image", "\u56FE\u7247\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }

  // Reject path-like names
  if (/[/\\]/.test(name)) {
    throw new DreamSkinError("invalid_image", "\u56FE\u7247\u540D\u79F0\u4E0D\u80FD\u5305\u542B\u8DEF\u5F84\u5206\u9694\u7B26\u3002");
  }

  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!ext) {
    throw new DreamSkinError("invalid_image", `\u56FE\u7247\u540D\u79F0\u7F3A\u5C11\u6269\u5C55\u540D\u3002`);
  }

  const actualExt = ext[1];
  const expectedExt = format.extension;

  // Normalize jpeg -> jpg
  const normalizedActual = actualExt === "jpeg" ? "jpg" : actualExt;

  if (normalizedActual !== expectedExt) {
    throw new DreamSkinError("invalid_image", `\u56FE\u7247\u6269\u5C55\u540D "${actualExt}" \u4E0E\u5B9E\u9645\u683C\u5F0F "${expectedExt}" \u4E0D\u5339\u914D\u3002`);
  }

  return name;
}

export function imageDataUri(bytes, format) {
  if (!bytes || !Buffer.isBuffer(bytes)) {
    throw new DreamSkinError("invalid_image", "\u56FE\u7247\u6570\u636E\u4E0D\u80FD\u4E3A\u7A7A\u3002");
  }
  if (!format || !format.mime) {
    throw new DreamSkinError("invalid_image", "\u56FE\u7247\u683C\u5F0F\u4FE1\u606F\u65E0\u6548\u3002");
  }
  return `data:${format.mime};base64,${bytes.toString("base64")}`;
}