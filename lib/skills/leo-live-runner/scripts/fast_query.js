#!/usr/bin/env node

/**
 * 🚀 Leo Live Runner - FAST / Kibana 极速多集群日志与全链路 Trace 检索引擎
 * 
 * 🌟 核心架构：四级阶梯式多平台自适应联动自愈架构 (Multi-Platform Tiered Self-Healing)
 *   1. ⚡ 一级通道（Fast-Path 极速直连）：已知微服务走纯 HTTP 毫秒级直连（< 200ms），全平台零依赖；
 *   2. 🍎 二级通道 A（macOS 智能探针）：遇新服务自动唤起 ego-browser 探针访问 fast.ke.com 动态自愈；
 *   3. 🪟 二级通道 B（Windows / 通用扩展桥接）：遇新服务通过本地 Leo Lantern 扩展（19527 端口）静默自愈；
 *   4. 📝 三级通道（人机兜底）：探针均不可用时，优雅提示一键安装脚本或手动提供集群/索引。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 路径定义：优先读取 Skill 自带预置字典，合并用户自学习字典
const PRESET_RESOURCE_FILE = path.join(__dirname, '..', 'resources', 'default_services.json');
const SHRIMP_SKILLS_DIR = path.join(os.homedir(), '.shrimp', 'skills', 'live-runner');
const USER_SERVICE_MAP_FILE = path.join(SHRIMP_SKILLS_DIR, 'service_map.json');

const LANTERN_BRIDGE_URL = 'http://127.0.0.1:19527';

function ensureShrimpDir() {
  if (!fs.existsSync(SHRIMP_SKILLS_DIR)) {
    fs.mkdirSync(SHRIMP_SKILLS_DIR, { recursive: true });
  }
}

function loadAllServices() {
  let presetMap = {};
  if (fs.existsSync(PRESET_RESOURCE_FILE)) {
    try {
      presetMap = JSON.parse(fs.readFileSync(PRESET_RESOURCE_FILE, 'utf8'));
    } catch (e) {}
  }

  ensureShrimpDir();
  let userMap = {};
  if (fs.existsSync(USER_SERVICE_MAP_FILE)) {
    try {
      userMap = JSON.parse(fs.readFileSync(USER_SERVICE_MAP_FILE, 'utf8'));
    } catch (e) {}
  }

  return { ...presetMap, ...userMap };
}

function saveUserServiceMap(map) {
  ensureShrimpDir();
  try {
    fs.writeFileSync(USER_SERVICE_MAP_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {}
}

const serviceCatalog = loadAllServices();

// 解析命令行参数
const args = process.argv.slice(2);
const targetApp = args[0] || 'iot-platform';
let queryStr = args[1] || '*';
const rawTime = args[2] || '24h';
const size = parseInt(args[3] || '20', 10);

if (queryStr !== '*' && !queryStr.includes('"') && !queryStr.includes(':') && !queryStr.includes('AND') && !queryStr.includes('OR')) {
  queryStr = `"${queryStr}"`;
}

const timeFrom = rawTime.startsWith('now-') ? rawTime : `now-${rawTime}`;

// 匹配服务索引与目标集群
let matchedConfig = serviceCatalog[targetApp] || serviceCatalog[targetApp.replace(/[:_\-](prod|test|dev)$/, '')];

let targetIndex = null;
let targetCluster = 'https://fast108-kibana-logcenter-intra.intra.ke.com';

if (typeof matchedConfig === 'string') {
  targetIndex = matchedConfig;
} else if (matchedConfig && typeof matchedConfig === 'object') {
  targetIndex = matchedConfig.index;
  targetCluster = matchedConfig.cluster || targetCluster;
} else if (targetApp.startsWith('index-')) {
  targetIndex = targetApp;
}

/**
 * ⚡ 原生 HTTP 直连执行 Kibana ES 检索
 */
async function queryKibanaES(cluster, index, query, fromTime, limit) {
  const payload = {
    params: {
      index: index,
      wait_for_completion_timeout: '10s',
      body: {
        size: limit,
        query: {
          bool: {
            must: [
              { query_string: { query: query, analyze_wildcard: true } }
            ],
            filter: [
              {
                range: {
                  timestamp: {
                    gte: fromTime,
                    lte: 'now'
                  }
                }
              }
            ]
          }
        }
      }
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${cluster}/internal/search/es`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'kbn-xsrf': 'kibana',
        'kbn-version': '7.7.0'
      },
      body: JSON.stringify(payload)
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * 🍎 macOS 专属探针：ego-browser
 */
async function probeViaEgoBrowser(appCode) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    const localBin = path.join(os.homedir(), '.local', 'bin');
    const extraPaths = [localBin, '/usr/local/bin', '/opt/homebrew/bin'];
    const currentPaths = (env.PATH || '').split(path.delimiter);
    for (const p of extraPaths) {
      if (!currentPaths.includes(p)) currentPaths.unshift(p);
    }
    env.PATH = currentPaths.join(path.delimiter);

    const child = spawn('ego-browser', ['nodejs'], {
      env,
      stdio: ['pipe', 'pipe', 'ignore']
    });

    let output = '';
    child.stdout.on('data', d => { output += d.toString(); });
    child.on('error', (err) => {
      resolve({ error: `未找到 ego-browser 命令行: ${err.message}` });
    });
    child.on('close', (code) => {
      try {
        const learned = JSON.parse(output.trim());
        resolve(learned);
      } catch (e) {
        resolve({ error: '解析探针输出失败: ' + output });
      }
    });

    const script = `
      async function probe() {
        const task = await useOrCreateTaskSpace('leo-fast-probe');
        try {
          await openOrReuseTab('https://fast.ke.com/#/search', { wait: true, timeout: 12 });
          await click('.el-cascader input');
          await wait(0.4);
          await fillInput('.el-cascader input', ${JSON.stringify(appCode.replace(/[:_\\-](prod|test|dev)$/, ''))});
          await wait(1.5);
          
          await js(String.raw\`(() => {
            const items = [...document.querySelectorAll('.el-cascader__suggestion-item')];
            const target = items.find(it => it.textContent.includes(${JSON.stringify(appCode.replace(/[:_\\-](prod|test|dev)$/, ''))}));
            if (target) target.click();
          })()\`);
          
          await wait(2.5);
          const learned = await js(String.raw\`(() => {
            const iframe = document.querySelector('iframe');
            const src = iframe?.src || '';
            const cluster = src.match(/https:\\/\\/[^/]+/)?.[0];
            const index = src.match(/index:'([^']+)'/)?.[1] || src.match(/index%3A%27([^%]+)%27/)?.[1];
            return { cluster, index };
          })()\`);
          cliLog(JSON.stringify(learned || {}));
        } catch(e) {
          cliLog(JSON.stringify({ error: e.message }));
        } finally {
          await completeTaskSpace('leo-fast-probe', { keep: false });
        }
      }
      probe();
    `;

    child.stdin.write(script);
    child.stdin.end();
  });
}

/**
 * 🪟 Windows / 通用探针：Leo Lantern Chrome 扩展桥接 (127.0.0.1:19527)
 * 纯内聚实现，0 外部 CLI 依赖
 */
async function probeViaLanternExtension(appCode) {
  const cleanApp = appCode.replace(/[:_\-](prod|test|dev)$/, '');
  const sendCmd = async (type, params = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${LANTERN_BRIDGE_URL}/cmd`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, params, timeoutMs })
      });
      clearTimeout(timer);
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: e.message };
    }
  };

  // 1. 检查扩展 Bridge 是否在线
  try {
    const health = await fetch(`${LANTERN_BRIDGE_URL}/health`, { signal: AbortSignal.timeout(1500) });
    if (!health.ok) return { error: 'Lantern Bridge 离线' };
  } catch (e) {
    return { error: '未连接到 Leo Lantern 扩展 (端口 19527 离线)' };
  }

  try {
    // 2. 启动后台静默任务并打开 fast.ke.com
    await sendCmd('task.start', { title: 'leo-fast-probe', focus: false, sameWindow: true });
    await sendCmd('tabs.navigate', { url: 'https://fast.ke.com/#/search', focus: false });
    await sendCmd('dom.wait', { selector: '.el-cascader input', timeoutMs: 10000 });

    // 3. 点击级联菜单并输入微服务名
    await sendCmd('dom.click', { selector: '.el-cascader input' });
    await new Promise(r => setTimeout(r, 400));
    await sendCmd('dom.fill', { selector: '.el-cascader input', value: cleanApp });
    await new Promise(r => setTimeout(r, 1500));

    // 4. 在页面上下文执行 JS 选中菜单项并提取 Cluster & Index
    const evalScript = `
      (function() {
        const items = [...document.querySelectorAll('.el-cascader__suggestion-item')];
        const target = items.find(it => it.textContent.includes(${JSON.stringify(cleanApp)}));
        if (target) target.click();
        
        return new Promise(resolve => {
          setTimeout(() => {
            const iframe = document.querySelector('iframe');
            const src = iframe ? iframe.src : '';
            const clusterMatch = src.match(/https:\\/\\/[^/]+/);
            const indexMatch = src.match(/index:'([^']+)'/) || src.match(/index%3A%27([^%]+)%27/);
            resolve({
              cluster: clusterMatch ? clusterMatch[0] : null,
              index: indexMatch ? indexMatch[1] : null
            });
          }, 2000);
        });
      })()
    `;

    const evalResult = await sendCmd('page.eval', { script: evalScript }, 12000);
    const learned = evalResult?.result?.evalResult;

    // 5. 任务清理（关闭后台标签页）
    await sendCmd('task.end', { closeGroup: true }).catch(() => {});

    if (learned && learned.index) {
      return learned;
    }
    return { error: '扩展探针未能从页面提取到有效索引' };
  } catch (err) {
    await sendCmd('task.end', { closeGroup: true }).catch(() => {});
    return { error: err.message };
  }
}

/**
 * 格式化并输出结果
 */
function renderOutput(targetApp, targetIndex, targetCluster, queryStr, timeFrom, esResult, totalCost, isLearned, isHealed) {
  const hitsObj = esResult?.rawResponse?.hits || {};
  const totalHits = typeof hitsObj.total === 'object' ? hitsObj.total.value : hitsObj.total || 0;
  let rawHits = hitsObj.hits || [];

  rawHits.sort((a, b) => {
    const tA = (a._source && (a._source.timestamp || a._source['@timestamp'] || a._source.time || a._source.logTime)) || '';
    const tB = (b._source && (b._source.timestamp || b._source['@timestamp'] || b._source.time || b._source.logTime)) || '';
    return tA.localeCompare(tB);
  });

  const hitList = rawHits.map((h, idx) => {
    const s = h._source || {};
    return {
      step: idx + 1,
      timestamp: s.timestamp || s['@timestamp'] || s.time || s.logTime,
      logLevel: s.loglevel || s.logLevel || 'INFO',
      spanId: s.spanId || null,
      bltag: s.data_bltag || null,
      uri: s.data_uri || s.uri || null,
      message: s.data_info_msg || s.logDetail || s.message || (s.data_body ? JSON.stringify({ body: s.data_body, args: s.data_args }) : JSON.stringify(s)),
      tid: s.tid || s.trace_id || null,
      sid: s.sid || null,
      machine: s.machineName || s.host_name || null
    };
  });

  const output = {
    summary: {
      targetApp,
      indexPattern: targetIndex,
      kibanaCluster: targetCluster,
      isLearned,
      isHealed,
      query: queryStr,
      timeRange: `${timeFrom} ~ now`,
      totalHits,
      returnedCount: hitList.length,
      esQueryTookMs: esResult?.rawResponse?.took || 0,
      totalCostMs: totalCost
    },
    logs: hitList
  };

  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  const startTime = Date.now();
  let isLearned = false;
  let isHealed = false;
  let esResult = null;

  // 1. 【一级通道】如果已有缓存索引与集群，尝试 HTTP 极速直连
  if (targetIndex && targetCluster) {
    try {
      esResult = await queryKibanaES(targetCluster, targetIndex, queryStr, timeFrom, size);
    } catch (directErr) {
      // 直连失败（可能集群迁移或网络故障），触发自愈
      isHealed = true;
    }
  }

  // 2. 【二级通道：自愈与自学习】如果未收录或直连报错，依次尝试跨平台智能探针
  if (!esResult || !esResult.rawResponse) {
    let learned = null;
    let probeType = '';

    // (A) 若为 macOS，优先尝试 ego-browser
    if (process.platform === 'darwin') {
      learned = await probeViaEgoBrowser(targetApp);
      if (learned && learned.index) probeType = 'ego-browser';
    }

    // (B) 若 ego-browser 未命中或处于 Windows/Linux 环境，尝试 Chrome 扩展桥接 (Leo Lantern)
    if (!learned || !learned.index) {
      const extLearned = await probeViaLanternExtension(targetApp);
      if (extLearned && extLearned.index) {
        learned = extLearned;
        probeType = 'chrome-extension';
      }
    }

    // (C) 探针自愈成功，持久化并重试直连
    if (learned && learned.index) {
      targetIndex = learned.index.includes('*') ? learned.index : `${learned.index}*`;
      if (learned.cluster) targetCluster = learned.cluster;
      isLearned = true;

      // 覆盖/更新本地自学习缓存
      serviceCatalog[targetApp] = { index: targetIndex, cluster: targetCluster };
      saveUserServiceMap(serviceCatalog);

      // 使用最新自愈地址重试直连
      try {
        esResult = await queryKibanaES(targetCluster, targetIndex, queryStr, timeFrom, size);
      } catch (retryErr) {
        console.error(JSON.stringify({
          error: `自愈后重试直连仍失败 (${targetCluster}): ${retryErr.message}`,
          targetApp,
          targetIndex,
          targetCluster
        }, null, 2));
        process.exit(1);
      }
    } else {
      // (D) 探针均未能自愈，尝试基于服务名兜底
      if (!targetIndex) {
        targetIndex = targetApp.startsWith('index-') ? targetApp : `${targetApp}*`;
      }
      try {
        esResult = await queryKibanaES(targetCluster, targetIndex, queryStr, timeFrom, size);
      } catch (finalErr) {
        console.error(JSON.stringify({
          error: `查询失败: 未找到微服务 [${targetApp}] 的匹配索引，且智能探针自愈未生效`,
          details: finalErr.message,
          suggestions: [
            "1. 若在 Windows: 请在 Chrome 中加载扩展 extensions/leo-cookie-txt-locally (可运行 scripts/setup_chrome_ext.bat)",
            "2. 若在 macOS: 可执行内置安装脚本 sh scripts/install_ego.sh 启用 ego-browser 探针",
            "3. 或直接向 AI 提供该微服务的 Cluster 与 Index 模式即可自动固化缓存"
          ]
        }, null, 2));
        process.exit(1);
      }
    }
  }

  const totalCost = Date.now() - startTime;
  renderOutput(targetApp, targetIndex, targetCluster, queryStr, timeFrom, esResult, totalCost, isLearned, isHealed);
}

main().catch(err => {
  console.error('Execution Error: ' + err.stack);
  process.exit(1);
});
