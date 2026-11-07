import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec, shrinkImage } from "./media.mjs";
import { findSkill, readJson, writeJson } from "./store.mjs";

const CHUNK_LIMIT = 10_000; // bytes; keeps a single insert well below request limits
const UPLOAD_LIMIT = 5 * 1024 * 1024; // Craft rejects larger files with FILE_TOO_LARGE
const PRIVATE_AVAILABILITY = new Set(["private", "premium_only", "subscriber_only", "needs_auth"]);

/** Uploaded assets open without login, so only frames of a publicly available web video go up by default. */
export const framesPublicByDefault = (video) => Boolean(video.url) && !PRIVATE_AVAILABILITY.has(video.availability);

/** Splits a note into ordered text chunks and standalone local images. */
export function splitNote(markdown) {
  // The title becomes the document name, so it must not repeat as body text.
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\s*#\s+.+\n?/, "");
  const items = [];
  let buffer = [];
  let size = 0;
  let inCode = false;
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) items.push({ type: "text", text });
    buffer = [];
    size = 0;
  };
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
    const image = !inCode && line.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (image && !/^https?:/.test(image[2])) {
      flush();
      items.push({ type: "image", alt: image[1], path: image[2] });
      continue;
    }
    if (!inCode && (/^##\s/.test(line) || (size > CHUNK_LIMIT && line.trim() === ""))) flush();
    buffer.push(line);
    size += Buffer.byteLength(line) + 1;
  }
  flush();
  return items;
}

function noteTitle(markdown, fallback) {
  const front = markdown.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  const fromFront = front?.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  return fromFront || markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function craftCli(script) {
  return (...args) => {
    const res = exec(process.execPath, [script, ...args]);
    if (!res.ok) throw new Error(`Craft 调用失败（${args.slice(0, 2).join(" ")}）：${(res.stderr || res.stdout).trim().slice(-400)}`);
    return res.stdout;
  };
}

function findFolderId(nodes, name) {
  for (const node of nodes || []) {
    if (node.name === name) return node.id;
    const nested = findFolderId(node.folders, name);
    if (nested) return nested;
  }
  return null;
}

function resolveFolder(cli, name) {
  const found = findFolderId(JSON.parse(cli("folders", "list", "--json")).items, name);
  if (found) return found;
  const created = JSON.parse(cli("folders", "create", name));
  return created.items?.[0]?.id || created.id;
}

function uploadable(file, tmp) {
  if (fs.statSync(file).size <= UPLOAD_LIMIT) return file;
  const small = path.join(tmp, `small-${path.basename(file)}`);
  if (shrinkImage(file, small) && fs.statSync(small).size <= UPLOAD_LIMIT) return small;
  return null;
}

/** Creates the Craft document in order (text, frames), then reads it back to verify. */
export function syncToCraft({ dir, notePath, folder, uploadFrames, force, craftApiDir }) {
  const api = findSkill("leo-craft-api", craftApiDir);
  if (!api) return { status: "unsynced", reason: "找不到 leo-craft-api，笔记保留在本地（未安装就先安装；不在同级目录时用 --craft-api 传它的目录）" };

  const receipt = path.join(dir, "产出", ".craft-sync.json");
  if (fs.existsSync(receipt) && !force) return { status: "already_synced", ...readJson(receipt) };

  const cli = craftCli(path.join(api, "scripts", "craft-api.mjs"));
  const markdown = fs.readFileSync(notePath, "utf8");
  const items = splitNote(markdown);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "video-relay-craft-"));
  try {
    cli("info");
    const title = noteTitle(markdown, path.basename(dir));
    const created = JSON.parse(cli("docs", "create", title, ...(folder ? ["--folder", resolveFolder(cli, folder)] : [])));
    const doc = created.items[0];
    const partial = { document_id: doc.id, link: doc.clickableLink, title };
    const assets = [];
    const skipped = [];
    try {
      for (const item of items) {
        if (item.type === "text") {
          const chunk = path.join(tmp, "chunk.md");
          fs.writeFileSync(chunk, item.text, "utf8");
          cli("blocks", "insert", "--page", doc.id, "--file", chunk);
          continue;
        }
        const file = path.resolve(path.dirname(notePath), item.path);
        const ready = uploadFrames && fs.existsSync(file) ? uploadable(file, tmp) : null;
        if (!ready) {
          skipped.push(item.path);
          cli("blocks", "insert", "--page", doc.id, "--markdown", `*${item.alt || "画面"}：图片保留在本地 ${path.basename(item.path)}*`);
          continue;
        }
        assets.push(JSON.parse(cli("upload", ready, "--page", doc.id)).assetUrl);
        // Craft drops an uploaded image's alt text, so the caption becomes its own line.
        if (item.alt) cli("blocks", "insert", "--page", doc.id, "--markdown", `*${item.alt}*`);
      }
      const source = `*来源目录：${dir}*`;
      cli("blocks", "insert", "--page", doc.id, "--markdown", source);

      const readBack = cli("blocks", "get", doc.id, "--format", "markdown");
      const missing = assets.filter((url) => !readBack.includes(url));
      const headings = items.flatMap((i) => (i.type === "text" ? [...i.text.matchAll(/^##+\s+(.+)$/gm)].map((m) => m[1].trim()) : []));
      const missingHeadings = headings.filter((h) => !readBack.includes(h));
      if (missing.length || missingHeadings.length) {
        return { status: "verify_failed", ...partial, missing_assets: missing, missing_headings: missingHeadings };
      }
    } catch (err) {
      // A half-written note must not pile up across retries; the trash keeps it recoverable.
      let trashed = true;
      try { cli("docs", "delete", doc.id); } catch { trashed = false; }
      return { status: "write_failed", ...partial, half_written_doc_in_trash: trashed, reason: err.message };
    }
    const result = { ...partial, uploaded_frames: assets.length, local_only_frames: skipped, synced_at: new Date().toISOString() };
    writeJson(receipt, result);
    return { status: "synced", ...result };
  } catch (err) {
    return { status: "unsynced", reason: err.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
