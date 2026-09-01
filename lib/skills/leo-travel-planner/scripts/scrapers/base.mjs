/**
 * scrapers/base.mjs
 * 
 * 网页抓取通用底层通信库 (Leo Lantern Bridge 客户端)
 * 职责：
 * 1. 探针连接与心跳健康检查 (127.0.0.1:19527)
 * 2. 浏览器标签页探测、认领 (claim) 与导航 (goto)
 * 3. 页面元素就绪动态监听 (dom.wait) 与内容提取 (dom.content)
 * 4. 任务生命周期与安全退出保证：100% 自动解散标签组 (closeGroup: true)，绝不在用户浏览器留下任何彩色标签组！
 */

import http from "node:http";

export const BRIDGE_PORT = 19527;
export const BRIDGE_HOST = "127.0.0.1";

/**
 * 底层 HTTP 请求封装
 */
export function sendBridge(path, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const req = http.request(
      {
        hostname: BRIDGE_HOST,
        port: BRIDGE_PORT,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
          ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({ raw: body });
          }
        });
      }
    );
    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * 派发 Bridge 指令
 */
export async function runCmd(type, params = {}, timeoutMs = 15000) {
  const res = await sendBridge("/cmd", "POST", { type, params, timeoutMs });
  if (res.ok === false) {
    throw new Error(`[Bridge Error] 指令 '${type}' 失败: ${res.error?.message || JSON.stringify(res.error)}`);
  }
  return res.result !== undefined ? res.result : res;
}

/**
 * 检查 Chrome 扩展连通状态
 */
export async function checkBridgeHealth() {
  const health = await sendBridge("/health").catch(() => null);
  if (!health || !health.ok || !health.extensionOnline) {
    throw new Error(
      "[Bridge Unavailable] 未连接到 Chrome 插件！请确保日常 Chrome 已启动且已加载 Leo Lantern 扩展。"
    );
  }
  return health;
}

/**
 * 获取浏览器当前打开的所有标签页
 */
export async function listTabs() {
  const tabs = await runCmd("tabs.list");
  return tabs || [];
}

/**
 * 查找或创建匹配特定 URL 域名的标签页
 */
export async function findOrCreateTab(domainMatch, targetUrl) {
  const tabs = await listTabs();
  const existing = tabs.find((t) => t.url && t.url.includes(domainMatch));
  if (existing) {
    return { id: existing.id, reused: true, tab: existing };
  }
  const newTab = await runCmd("tabs.new", { url: targetUrl, focus: false });
  return { id: newTab.id, reused: false, tab: newTab };
}

/**
 * 安全任务执行包裹器（核心防呆：无论执行成功或报错，100% 自动清理并解散 Chrome 标签组）
 */
export async function withScraperTask(taskTitle, taskFn, options = {}) {
  const { sameWindow = true, focus = false } = options;
  await checkBridgeHealth();

  // 1. 开启任务
  await runCmd("task.start", { title: taskTitle, sameWindow, focus });

  try {
    // 2. 执行具体的业务抓取逻辑
    return await taskFn({ runCmd, sendBridge, listTabs, findOrCreateTab });
  } finally {
    // 3. 强约束：自动解散标签组，不留任何彩色痕迹
    try {
      await runCmd("task.end", { closeGroup: true });
    } catch (e) {
      console.warn("[Bridge Cleanup] 解散标签组警告:", e.message);
    }
  }
}
