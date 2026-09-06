import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp", ".avif"
]);

/**
 * Detect if gallery-dl is installed and return its path + version.
 * @returns {{path: string, version: string} | null}
 */
export function detectGalleryDl() {
  // Check direct PATH execution
  try {
    const version = execSync("gallery-dl --version", { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
    let binPath = "gallery-dl";
    try {
      const whichCmd = process.platform === "win32" ? "where gallery-dl" : "which gallery-dl";
      binPath = execSync(whichCmd, { encoding: "utf8", timeout: 5000, windowsHide: true }).trim().split(/[\r\n]+/)[0] || "gallery-dl";
    } catch {
      // ignore
    }
    return { path: binPath, version };
  } catch {
    // Check user local bin on Windows
    if (process.platform === "win32") {
      const localPath = path.join(process.env.USERPROFILE || "", ".local", "bin", "gallery-dl.exe");
      if (fs.existsSync(localPath)) {
        try {
          const version = execSync(`"${localPath}" --version`, { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
          return { path: localPath, version };
        } catch {
          return { path: localPath, version: "installed" };
        }
      }
    }
    return null;
  }
}

/**
 * Recursively find image files in a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function findImageFilesInDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findImageFilesInDir(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/**
 * Download image from URL using gallery-dl, with fallback to direct HTTP fetch.
 * @param {string} url
 * @param {string} destDir
 * @param {object} options
 * @returns {Promise<{ filePath: string, fileName: string, buffer: Buffer, size: number, source: string }>}
 */
export async function downloadImageFromUrl(url, destDir, options = {}) {
  if (!url || typeof url !== "string") {
    throw new Error("Invalid URL provided for image download");
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const galleryDlInfo = detectGalleryDl();
  let downloadedFilePath = null;
  let downloadSource = "none";

  // Try gallery-dl if available
  if (galleryDlInfo) {
    try {
      const bin = galleryDlInfo.path;
      await new Promise((resolve, reject) => {
        const args = ["-D", destDir, "--no-part", url];
        const proc = spawn(bin, args, {
          timeout: options.timeout || 60000,
          windowsHide: true,
        });

        let stderr = "";
        proc.stderr?.on("data", (d) => { stderr += d.toString(); });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`gallery-dl exited with code ${code}: ${stderr.trim()}`));
          }
        });

        proc.on("error", (err) => reject(err));
      });

      const foundFiles = findImageFilesInDir(destDir);
      if (foundFiles.length > 0) {
        // Sort by size or mtime descending to get the best asset
        foundFiles.sort((a, b) => {
          const sa = fs.statSync(a).size;
          const sb = fs.statSync(b).size;
          return sb - sa;
        });
        downloadedFilePath = foundFiles[0];
        downloadSource = "gallery-dl";
      }
    } catch (err) {
      // gallery-dl failed or unsupported extractor, fallback to direct fetch
      downloadedFilePath = null;
    }
  }

  // Fallback to direct HTTP fetch if gallery-dl was not available or did not produce an image
  if (!downloadedFilePath) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/*,text/html,*/*",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download image from URL: HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type") || "";
    let ext = ".png";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = ".jpg";
    else if (contentType.includes("png")) ext = ".png";
    else if (contentType.includes("webp")) ext = ".webp";
    else if (contentType.includes("gif")) ext = ".gif";
    else if (contentType.includes("svg")) ext = ".svg";
    else {
      // derive extension from url pathname
      try {
        const u = new URL(url);
        const urlExt = path.extname(u.pathname).toLowerCase();
        if (IMAGE_EXTENSIONS.has(urlExt)) ext = urlExt;
      } catch {
        // keep .png
      }
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      throw new Error("Downloaded image buffer is empty");
    }

    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    const fileName = `downloaded_${hash}${ext}`;
    const targetPath = path.join(destDir, fileName);
    fs.writeFileSync(targetPath, buffer);

    downloadedFilePath = targetPath;
    downloadSource = "fetch";
  }

  const buffer = fs.readFileSync(downloadedFilePath);
  const fileName = path.basename(downloadedFilePath);
  const stat = fs.statSync(downloadedFilePath);

  return {
    filePath: downloadedFilePath,
    fileName,
    buffer,
    size: stat.size,
    source: downloadSource,
  };
}
