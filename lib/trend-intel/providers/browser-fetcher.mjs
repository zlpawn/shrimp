import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import WebSocket from "ws";
import { resolveProxyUrl } from "./proxy-helper.mjs";

/**
 * Locate a Chrome or Edge browser executable on the system.
 * @returns {string|null}
 */
export function findBrowserExecutable() {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const candidates = [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  if (isMac) {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  // Linux / Unix
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium"
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Find an available TCP port on localhost.
 * @param {number} [startPort=9333]
 * @returns {Promise<number>}
 */
export async function getAvailablePort(startPort = 9333) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => {
      resolve(getAvailablePort(startPort + 1));
    });
    server.listen(startPort, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Normalize raw Discourse topics into Standard Items.
 * @param {Array<object>} rawTopics
 * @param {string} [platform="linux_do"]
 * @param {object} [feedMeta={}]
 * @returns {Array<object>}
 */
export function normalizeDiscourseTopics(rawTopics = [], platform = "linux_do", feedMeta = {}) {
  const now = new Date().toISOString();
  return (rawTopics || [])
    .map((t, idx) => {
      const topicId = t.id || t.topic_id || `item_${Date.now()}_${idx}`;
      const title = String(t.title || t.name || "").trim();
      const baseUrl = feedMeta.baseUrl || "https://linux.do";
      const slug = t.slug ? `/${t.slug}` : "";
      const url = t.url
        ? (t.url.startsWith("http") ? t.url : `${baseUrl}${t.url}`)
        : `${baseUrl}/t${slug}/${topicId}`;
      const score = Number(t.like_count || t.posts_count || t.views || 0);

      return {
        id: `${platform}:${url}`,
        source: "browser_cdp",
        platform,
        country: "CN",
        language: "zh",
        type: "community",
        title,
        url,
        rank: idx + 1,
        previous_rank: 0,
        velocity: "0",
        score,
        first_seen_at: t.created_at || now,
        last_seen_at: now,
        collected_at: now,
        raw: {
          title,
          summary: t.excerpt || t.snippet || (t.views ? `浏览量: ${t.views} · 回复: ${t.posts_count || 0}` : title),
          views: t.views,
          likeCount: t.like_count,
          replyCount: t.posts_count,
          author: t.last_poster_username || t.creator,
          platformName: feedMeta.platformName || feedMeta.name || (platform === "linux_do" ? "LINUX DO 每日热榜" : platform),
          icon: feedMeta.icon || (platform === "linux_do" ? "🐧" : "💻"),
          feedUrl: feedMeta.feedUrl || ""
        }
      };
    })
    .filter((item) => Boolean(item.title));
}

/**
 * Return a realistic desktop Chrome User-Agent header matching the current OS.
 * Prevents Cloudflare Turnstile from identifying headless Chrome.
 * @param {string} [platform=process.platform]
 * @returns {string}
 */
export function getRealisticUserAgent(platform = process.platform) {
  if (platform === "darwin") {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
  }
  if (platform === "win32") {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
  }
  return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
}

/**
 * Fetch Discourse JSON via an off-screen background browser with CDP.
 * Completely autonomous, bypasses Cloudflare Turnstile without user interaction.
 *
 * @param {object} options
 * @param {string} [options.url] Target URL (RSS or JSON)
 * @param {string} [options.cookie] Cookie string containing cf_clearance
 * @param {object} [options.proxy] Proxy configuration
 * @param {string} [options.sourceId="linux_do"]
 * @param {string} [options.platformName]
 * @param {string} [options.icon]
 * @param {number} [options.timeout=20000]
 * @param {string} [options.userAgent]
 * @returns {Promise<Array<object>>}
 */
export async function fetchDiscourseViaBrowser(options = {}) {
  const {
    url = "https://linux.do/top.json",
    cookie = "",
    proxy = {},
    sourceId = "linux_do",
    platformName = "LINUX DO 每日热榜",
    icon = "🐧",
    timeout = 20000,
    userAgent = ""
  } = options;

  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    throw new Error("No compatible Chrome or Edge browser executable found on the system");
  }

  // Derive target JSON URL
  let targetUrl = url;
  if (targetUrl.includes(".rss") || targetUrl.includes(".xml")) {
    targetUrl = targetUrl.replace(/\/top\/daily\.rss.*$/, "/top.json").replace(/\/latest\.rss.*$/, "/latest.json");
    if (!targetUrl.endsWith(".json")) {
      targetUrl = "https://linux.do/top.json";
    }
  }

  // Extract base domain
  const parsedTargetUrl = new URL(targetUrl);
  const domain = parsedTargetUrl.hostname;
  const baseUrl = `${parsedTargetUrl.protocol}//${parsedTargetUrl.host}`;

  // Resolve proxy string for browser
  let proxyArg = "";
  const effectiveProxyUrl = resolveProxyUrl(proxy);
  if (effectiveProxyUrl) {
    proxyArg = `--proxy-server=${effectiveProxyUrl.replace("socks5h://", "socks5://")}`;
  }

  // Find free CDP port
  const cdpPort = await getAvailablePort(9333 + Math.floor(Math.random() * 50));
  const tmpDir = path.join(os.tmpdir(), `shrimp-geek-browser-${Date.now()}-${cdpPort}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const effectiveUa = userAgent || getRealisticUserAgent();
  const launchArgs = [
    "--headless=new",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tmpDir}`,
    `--user-agent=${effectiveUa}`,
    "--window-size=1280,800",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-default-apps",
    "--mute-audio"
  ];

  if (process.platform === "linux") {
    launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  if (proxyArg) {
    launchArgs.push(proxyArg);
  }

  let proc = null;
  let ws = null;
  let timeoutTimer = null;

  try {
    proc = spawn(browserPath, launchArgs, { stdio: "ignore" });

    // Ensure cleanup if process hangs
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new Error(`Browser fetch timed out after ${timeout}ms`));
      }, timeout);
    });

    const executionPromise = (async () => {
      // 1. Wait for CDP endpoint to be ready
      let versionInfo = null;
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
          if (res.ok) {
            versionInfo = await res.json();
            break;
          }
        } catch {}
      }

      if (!versionInfo) {
        throw new Error(`Browser started but failed to bind CDP port ${cdpPort}`);
      }

      // 2. Open new tab/target
      const newPageRes = await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" });
      const target = await newPageRes.json();
      if (!target?.webSocketDebuggerUrl) {
        throw new Error("Browser failed to create debuggable page target");
      }

      // 3. Connect WebSocket
      ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      let msgId = 1;
      function send(method, params = {}) {
        return new Promise((resolve, reject) => {
          const id = msgId++;
          const handler = (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.id === id) {
                ws.off("message", handler);
                if (msg.error) reject(new Error(msg.error.message || "CDP error"));
                else resolve(msg.result);
              }
            } catch {}
          };
          ws.on("message", handler);
          ws.send(JSON.stringify({ id, method, params }));
        });
      }

      await send("Page.enable");
      await send("Runtime.enable");
      await send("Network.enable");

      // Mask automation flags and ensure realistic User-Agent
      await send("Network.setUserAgentOverride", { userAgent: effectiveUa });
      await send("Page.addScriptToEvaluateOnNewDocument", {
        source: "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
      });

      // 4. Inject Cookies if provided
      if (cookie) {
        const cookiePairs = cookie.split(";").map((s) => s.trim()).filter(Boolean);
        for (const pair of cookiePairs) {
          const eqIdx = pair.indexOf("=");
          if (eqIdx > 0) {
            const name = pair.slice(0, eqIdx).trim();
            const value = pair.slice(eqIdx + 1).trim();
            try {
              await send("Network.setCookie", {
                name,
                value,
                domain: `.${domain.replace(/^www\./, "")}`,
                path: "/",
                secure: true,
                httpOnly: false
              });
            } catch {}
          }
        }
      }

      // 5. Navigate to target Discourse JSON
      await send("Page.navigate", { url: targetUrl });

      // 6. Poll for JSON response (handling Cloudflare 5-second shield if any)
      let parsedTopics = null;
      for (let poll = 0; poll < 15; poll++) {
        await new Promise((r) => setTimeout(r, 800));

        const evalRes = await send("Runtime.evaluate", {
          expression: "document.body ? document.body.innerText : ''"
        });

        const text = String(evalRes?.result?.value || "").trim();
        if (text && text.startsWith("{") && text.includes("topic_list")) {
          try {
            const data = JSON.parse(text);
            if (Array.isArray(data?.topic_list?.topics)) {
              parsedTopics = data.topic_list.topics;
              break;
            }
          } catch {}
        }
      }

      if (!parsedTopics || parsedTopics.length === 0) {
        throw new Error(`Failed to extract topics from "${targetUrl}" (Cloudflare challenge or empty payload)`);
      }

      return normalizeDiscourseTopics(parsedTopics, sourceId, {
        baseUrl,
        platformName,
        icon,
        feedUrl: url
      });
    })();

    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}
