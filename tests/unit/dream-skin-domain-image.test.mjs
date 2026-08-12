import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectImage,
  assertImageNameMatchesFormat,
  imageDataUri,
  MAX_THEME_IMAGE_BYTES,
} from "../../lib/dream-skin/domain/image-format.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

// Minimal valid byte fixtures for each format
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const GIF87_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00]);
const GIF89_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
const BMP_BYTES = Buffer.from([0x42, 0x4d, 0x00, 0x00]);

test("inspectImage detects PNG", () => {
  const result = inspectImage(PNG_BYTES);
  assert.equal(result.extension, "png");
  assert.equal(result.mime, "image/png");
  assert.equal(result.size, PNG_BYTES.length);
});

test("inspectImage detects JPEG", () => {
  const result = inspectImage(JPEG_BYTES);
  assert.equal(result.extension, "jpg");
  assert.equal(result.mime, "image/jpeg");
});

test("inspectImage detects WebP", () => {
  const result = inspectImage(WEBP_BYTES);
  assert.equal(result.extension, "webp");
  assert.equal(result.mime, "image/webp");
});

test("inspectImage detects GIF87a", () => {
  const result = inspectImage(GIF87_BYTES);
  assert.equal(result.extension, "gif");
  assert.equal(result.mime, "image/gif");
});

test("inspectImage detects GIF89a", () => {
  const result = inspectImage(GIF89_BYTES);
  assert.equal(result.extension, "gif");
  assert.equal(result.mime, "image/gif");
});

test("inspectImage detects BMP", () => {
  const result = inspectImage(BMP_BYTES);
  assert.equal(result.extension, "bmp");
  assert.equal(result.mime, "image/bmp");
});

test("inspectImage validates expectedName matches format", () => {
  const result = inspectImage(PNG_BYTES, { expectedName: "background.png" });
  assert.equal(result.extension, "png");
});

test("inspectImage rejects mismatched expectedName", () => {
  assert.throws(
    () => inspectImage(PNG_BYTES, { expectedName: "background.jpg" }),
    { code: "invalid_image" },
  );
});

test("inspectImage normalizes .jpeg to .jpg", () => {
  const result = inspectImage(JPEG_BYTES, { expectedName: "background.jpeg" });
  assert.equal(result.extension, "jpg");
});

test("inspectImage rejects empty bytes", () => {
  assert.throws(() => inspectImage(Buffer.alloc(0)), { code: "invalid_image" });
});

test("inspectImage rejects null/undefined", () => {
  assert.throws(() => inspectImage(null), { code: "invalid_image" });
  assert.throws(() => inspectImage(undefined), { code: "invalid_image" });
});

test("inspectImage rejects SVG content", () => {
  const svg = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  assert.throws(() => inspectImage(svg), { code: "invalid_image" });
});

test("inspectImage rejects XML content", () => {
  const xml = Buffer.from("<?xml version=\"1.0\"?><root></root>");
  assert.throws(() => inspectImage(xml), { code: "invalid_image" });
});

test("inspectImage rejects HTML content", () => {
  const html = Buffer.from("<!DOCTYPE html><html><body></body></html>");
  assert.throws(() => inspectImage(html), { code: "invalid_image" });
});

test("inspectImage rejects unknown bytes", () => {
  const unknown = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  assert.throws(() => inspectImage(unknown), { code: "invalid_image" });
});

test("inspectImage rejects oversized bytes", () => {
  const big = Buffer.alloc(MAX_THEME_IMAGE_BYTES + 1, 0x89);
  // Make it look like a PNG so the signature passes but size check fails
  big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;
  big[4] = 0x0d; big[5] = 0x0a; big[6] = 0x1a; big[7] = 0x0a;
  assert.throws(() => inspectImage(big), { code: "invalid_image" });
});

test("inspectImage accepts exactly at size limit", () => {
  const exact = Buffer.alloc(MAX_THEME_IMAGE_BYTES, 0x00);
  exact[0] = 0x89; exact[1] = 0x50; exact[2] = 0x4e; exact[3] = 0x47;
  exact[4] = 0x0d; exact[5] = 0x0a; exact[6] = 0x1a; exact[7] = 0x0a;
  const result = inspectImage(exact);
  assert.equal(result.extension, "png");
});

// --- assertImageNameMatchesFormat ---

test("assertImageNameMatchesFormat accepts matching extension", () => {
  assert.equal(
    assertImageNameMatchesFormat("bg.png", { extension: "png" }),
    "bg.png",
  );
});

test("assertImageNameMatchesFormat accepts .jpeg for jpg format", () => {
  assert.equal(
    assertImageNameMatchesFormat("bg.jpeg", { extension: "jpg" }),
    "bg.jpeg",
  );
});

test("assertImageNameMatchesFormat rejects path separator", () => {
  assert.throws(
    () => assertImageNameMatchesFormat("dir/bg.png", { extension: "png" }),
    { code: "invalid_image" },
  );
});

test("assertImageNameMatchesFormat rejects missing extension", () => {
  assert.throws(
    () => assertImageNameMatchesFormat("background", { extension: "png" }),
    { code: "invalid_image" },
  );
});

test("assertImageNameMatchesFormat rejects empty name", () => {
  assert.throws(
    () => assertImageNameMatchesFormat("", { extension: "png" }),
    { code: "invalid_image" },
  );
});

// --- imageDataUri ---

test("imageDataUri produces correct data URI", () => {
  const bytes = PNG_BYTES;
  const format = { extension: "png", mime: "image/png", size: bytes.length };
  const uri = imageDataUri(bytes, format);
  assert.ok(uri.startsWith("data:image/png;base64,"));
  assert.ok(uri.includes(Buffer.from(bytes).toString("base64")));
});

test("imageDataUri rejects null bytes", () => {
  assert.throws(() => imageDataUri(null, { mime: "image/png" }), { code: "invalid_image" });
});

test("imageDataUri rejects null format", () => {
  assert.throws(() => imageDataUri(PNG_BYTES, null), { code: "invalid_image" });
});