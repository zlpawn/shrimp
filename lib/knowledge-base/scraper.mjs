import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function extractImageUrlsFromHtml(html, baseUrl = "") {
  if (!html) return [];
  const urls = new Set();

  // Match src and data-src in img/source tags
  const imgTagRegex = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgTagRegex.exec(html)) !== null) {
    const tag = match[0];
    const srcMatch = tag.match(/\b(?:data-src|src)\s*=\s*["']([^"']+)["']/i);
    if (srcMatch && srcMatch[1]) {
      let rawUrl = srcMatch[1].trim();
      if (rawUrl.startsWith("//")) {
        rawUrl = "https:" + rawUrl;
      }
      if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
        urls.add(rawUrl);
      } else if (baseUrl && !rawUrl.startsWith("data:") && !rawUrl.startsWith("javascript:")) {
        try {
          const resolved = new URL(rawUrl, baseUrl).href;
          urls.add(resolved);
        } catch {
          // ignore invalid relative url
        }
      }
    }
  }

  return Array.from(urls);
}

export function rewriteHtmlImages(html, imageMap) {
  if (!html || !imageMap || imageMap.size === 0) return html;
  let result = html;

  for (const [remoteUrl, localUrl] of imageMap.entries()) {
    // Replace src="..." and data-src="..."
    const escaped = remoteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(\\b(?:src|data-src)\\s*=\\s*["'])${escaped}(["'])`, "gi");
    result = result.replace(regex, `$1${localUrl}$2`);
  }

  return result;
}

export function createWebScraper({ lanternPath = null } = {}) {
  function extractTitle(html) {
    if (!html) return "网页文档";
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1].trim()) {
      return titleMatch[1].trim();
    }
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1].trim()) {
      return h1Match[1].trim();
    }
    return "网页文档";
  }

  async function getCookiesViaLantern(domain) {
    const defaultLantern = path.resolve("clis/leo-lantern/index.mjs");
    const cliPath = lanternPath || (fs.existsSync(defaultLantern) ? defaultLantern : null);
    if (!cliPath) return "";

    return new Promise((resolve) => {
      let stdout = "";
      const proc = spawn(process.execPath, [cliPath, "cookies", "--domain", domain], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      proc.on("close", (code) => {
        if (code === 0 && stdout) {
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.cookies && Array.isArray(parsed.cookies)) {
              const cookieStr = parsed.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
              return resolve(cookieStr);
            }
          } catch {
            // ignore
          }
        }
        resolve("");
      });
      proc.on("error", () => resolve(""));
    });
  }

  async function downloadImage(url, destPath, referer) {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };
    if (referer) {
      headers["Referer"] = referer;
    }
    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) {
      throw new Error(`Failed to download image ${url}: HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return buffer.length;
  }

  async function scrape(targetUrl, { docId, assetsDir, useLeo = false } = {}) {
    const parsedUrl = new URL(targetUrl);
    let cookieHeader = "";
    if (useLeo) {
      try {
        cookieHeader = await getCookiesViaLantern(parsedUrl.hostname);
      } catch {
        // fallback without cookies
      }
    }

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    };
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    const resp = await fetch(targetUrl, { headers, redirect: "follow" });
    if (!resp.ok) {
      throw new Error(`Failed to fetch web page ${targetUrl}: HTTP ${resp.status}`);
    }
    const rawHtml = await resp.text();
    const title = extractTitle(rawHtml);

    // Extract image URLs
    const imageUrls = extractImageUrlsFromHtml(rawHtml, targetUrl);
    const imageMap = new Map();
    const assets = [];

    if (assetsDir && imageUrls.length > 0) {
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      // Download up to 30 images with concurrency
      const limit = Math.min(imageUrls.length, 30);
      for (let i = 0; i < limit; i++) {
        const imgUrl = imageUrls[i];
        let ext = path.extname(new URL(imgUrl).pathname).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) {
          ext = ".png";
        }
        const filename = `img_${i}${ext}`;
        const localFilePath = path.join(assetsDir, filename);
        const webAssetUrl = `/v1/kb/files/${docId}/assets/${filename}`;

        try {
          const sizeBytes = await downloadImage(imgUrl, localFilePath, targetUrl);
          imageMap.set(imgUrl, webAssetUrl);
          assets.push({
            name: filename,
            localPath: localFilePath,
            url: webAssetUrl,
            remoteUrl: imgUrl,
            sizeBytes,
          });
        } catch {
          // Keep original URL on fail
        }
      }
    }

    // Rewrite images in HTML to point to local assets
    const cleanHtml = rewriteHtmlImages(rawHtml, imageMap);

    return {
      title,
      html: cleanHtml,
      rawHtml,
      assets,
      sourceUrl: targetUrl,
    };
  }

  return {
    extractTitle,
    getCookiesViaLantern,
    downloadImage,
    scrape,
  };
}
