#!/usr/bin/env node

/**
 * 🚀 Leo Live Runner - FAST / Kibana 极速多集群日志与全链路 Trace 检索引擎
 * 
 * 🌟 核心架构：双引擎联动自愈模式（Dual-Engine Self-Healing）
 *   1. ⚡ 一级通道（Fast-Path）：已知服务走纯 HTTP 极速直连（< 200ms），日常使用零等待；
 *   2. 🛡️ 二级通道（Self-Healing）：遇新服务或 Kibana 集群地址变更/报错时，自动唤起 ego-browser 探针访问 fast.ke.com 动态自愈纠错并更新本地缓存。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 路径定义：优先读取 Skill 自带预置字典，合并用户自学习字典
const PRESET_RESOURCE_FILE = path.join(__dirname, '..', 'resources', 'default_services.json');
const SHRIMP_SKILLS_DIR = path.join(os.homedir(), '.shrimp', 'skills', 'live-runner');
const USER_SERVICE_MAP_FILE = path.join(SHRIMP_SKILLS_DIR, 'service_map.json');

const KNOWN_CLUSTERS = [
  'https://fast108-kibana-logcenter-intra.intra.ke.com',
  'https://fast105-kibana-logcenter-intra.intra.ke.com',
  'https://fast101-kibana-logcenter-intra.intra.ke.com',
  'https://fast104-kibana-logcenter-intra.intra.ke.com',
  'https://fast102-kibana-logcenter-intra.intra.ke.com',
  'https://fast109-kibana-logcenter-intra.intra.ke.com'
];

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
let matchedConfig = serviceCatalog[targetApp] || serviceCatalog[targetApp.replace(/:prod$/, '')];

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
 * 🛡️ ego-browser 智能探针：访问 fast.ke.com 动态提取最新的 Cluster 与 Index 路由
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

  // 2. 【二级通道：自愈与自学习】如果未收录或直连报错，自动唤起 ego-browser 探针去 fast.ke.com 动态提取
  if (!esResult || !esResult.rawResponse) {
    const egoLearned = await probeViaEgoBrowser(targetApp);
    if (egoLearned && egoLearned.index) {
      targetIndex = egoLearned.index.includes('*') ? egoLearned.index : `${egoLearned.index}*`;
      if (egoLearned.cluster) targetCluster = egoLearned.cluster;
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
      // 探针未能提取到（如服务名完全不匹配），使用兜底策略
      if (!targetIndex) {
        targetIndex = targetApp.startsWith('index-') ? targetApp : `${targetApp}*`;
      }
      try {
        esResult = await queryKibanaES(targetCluster, targetIndex, queryStr, timeFrom, size);
      } catch (finalErr) {
        console.error(JSON.stringify({
          error: `查询失败: 未找到微服务 [${targetApp}] 的匹配索引，且探针自愈未成功`,
          details: egoLearned?.error || finalErr.message
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
