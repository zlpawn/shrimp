#!/usr/bin/env node

/**
 * 🚀 Leo Live Inspector - FAST / Kibana 极速多集群日志与全链路 Trace 检索引擎
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

/**
 * 🛠️ 完善的 CLI 参数解析器 (支持混合位置参数与 Named Flags)
 */
function parseCliArgs() {
  const argv = process.argv.slice(2);
  const options = {
    app: '',
    query: '*',
    time: '24h',
    from: null,
    to: 'now',
    size: 20,
    offset: 0,
    order: null,      // 'desc' | 'asc' | null (auto)
    level: null,      // 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
    bltag: null,      // 'request_in' | 'request_out' 等
    uri: null,        // '/api/xxx'
    traceId: null,
    env: 'prod',      // 'prod' | 'test' | 'dev'
    cluster: null,
    index: null,
    slim: false,
    format: 'json',   // 'json' | 'table' | 'brief'
    timeout: 15000,
    help: false
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--slim') {
      options.slim = true;
    } else if (arg === '--app' || arg === '-a') {
      options.app = argv[++i];
    } else if (arg === '--query' || arg === '-q') {
      options.query = argv[++i];
    } else if (arg === '--time' || arg === '-t') {
      options.time = argv[++i];
    } else if (arg === '--from') {
      options.from = argv[++i];
    } else if (arg === '--to') {
      options.to = argv[++i];
    } else if (arg === '--size' || arg === '-n' || arg === '--limit') {
      options.size = parseInt(argv[++i], 10) || 20;
    } else if (arg === '--offset' || arg === '--page') {
      options.offset = parseInt(argv[++i], 10) || 0;
    } else if (arg === '--order' || arg === '-o') {
      options.order = argv[++i]?.toLowerCase();
    } else if (arg === '--level' || arg === '-l') {
      options.level = argv[++i]?.toUpperCase();
    } else if (arg === '--bltag') {
      options.bltag = argv[++i];
    } else if (arg === '--uri' || arg === '-u') {
      options.uri = argv[++i];
    } else if (arg === '--traceId' || arg === '--tid') {
      options.traceId = argv[++i];
    } else if (arg === '--env' || arg === '-e') {
      options.env = argv[++i]?.toLowerCase();
    } else if (arg === '--cluster') {
      options.cluster = argv[++i];
    } else if (arg === '--index') {
      options.index = argv[++i];
    } else if (arg === '--format' || arg === '-f') {
      options.format = argv[++i]?.toLowerCase() || 'json';
    } else if (arg === '--timeout') {
      options.timeout = parseInt(argv[++i], 10) || 15000;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  // 映射位置参数
  if (!options.app && positional[0]) options.app = positional[0];
  if (options.query === '*' && positional[1]) options.query = positional[1];
  if (options.time === '24h' && positional[2]) options.time = positional[2];
  if (options.size === 20 && positional[3]) options.size = parseInt(positional[3], 10) || 20;

  if (!options.app) {
    options.app = 'iot-platform';
  }

  return options;
}

function printHelp() {
  console.log(`
🚀 Leo Live Inspector - FAST / Kibana 极速日志与 Trace 检索引擎

使用格式:
  node scripts/fast_query.js [appCode] [query/traceId] [timeRange] [size]
  node scripts/fast_query.js [flags]

常用参数:
  -a, --app <appCode>       微服务名 (如 iot-platform, utopia-scs-saas)
  -q, --query <queryStr>    Lucene 检索关键词 (默认: '*')
  -t, --time <timeRange>    相对时间范围 (如 15m, 1h, 24h, 7d, 默认: 24h)
      --from <time>         绝对或相对起始时间 (如 '2026-08-31 14:00:00' 或 'now-1h')
      --to <time>           绝对或相对结束时间 (默认: 'now')
  -n, --size <num>          返回最大条数 (默认: 20，Trace 模式默认: 50)
  -o, --order <desc|asc>    排序方式 (默认: desc 最新在前；Trace 模式默认: asc 正序)
  -l, --level <LEVEL>       日志级别过滤 (ERROR, WARN, INFO, DEBUG)
      --bltag <tag>         过滤出入参标签 (request_in, request_out 等)
  -u, --uri <path>          过滤接口 URI (如 /api/sync/lockDetail)
      --tid, --traceId <id> 指定 TraceId (自动切换为正序全链路回溯)
  -e, --env <prod|test|dev> 指定运行环境 (默认: prod)
      --cluster <url>       显式覆盖 Kibana ES 集群地址
      --index <pattern>     显式覆盖 ES 索引模式 (如 index-8172-7302*)
      --slim                瘦身模式 (缩短超长出入参与堆栈 JSON)
  -f, --format <format>     输出格式: json (默认) | table | brief
      --timeout <ms>        超时时间 (默认: 15000ms)
  -h, --help                打印帮助信息

示例:
  1. 查最新日志 (默认倒序):
     node scripts/fast_query.js iot-platform '*' 15m 10

  2. 查特定报错与级别:
     node scripts/fast_query.js utopia-scs-saas --level ERROR -t 1h -n 10

  3. 根据 TraceId 还原完整链路 (自动正序):
     node scripts/fast_query.js iot-platform --traceId "451553-10.25.132.155-764-1788160841173-977"

  4. 精确定位历史时间段:
     node scripts/fast_query.js iot-platform --from "2026-08-31 14:00:00" --to "2026-08-31 14:30:00" -n 50
`);
}

const opts = parseCliArgs();

if (opts.help) {
  printHelp();
  process.exit(0);
}

// 格式化时间函数
function formatTimeParam(timeVal) {
  if (!timeVal || timeVal === 'now') return 'now';
  if (timeVal.startsWith('now-')) return timeVal;
  if (/^\d+[smhdw]$/.test(timeVal)) return `now-${timeVal}`;
  // 检查是否为标准日期时间格式 "2026-08-31 14:00:00"
  if (/^\d{4}-\d{2}-\d{2}/.test(timeVal)) {
    const d = new Date(timeVal.replace(' ', 'T'));
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }
  return timeVal;
}

// TraceId 智能感知判定
const isTraceQuery = !!opts.traceId || 
  /^[\w\.\-]+-\d+\.\d+\.\d+\.\d+-\d+-\d+-\w+/.test(opts.query) ||
  /^\d{4,}-\d+\.\d+\.\d+\.\d+-/.test(opts.query);

if (opts.traceId) {
  opts.query = `"${opts.traceId}"`;
}

// 默认排序决策：Trace 查询默认 asc，普通查询默认 desc
const finalOrder = opts.order || (isTraceQuery ? 'asc' : 'desc');
const finalSize = isTraceQuery && opts.size === 20 ? 50 : opts.size;

// 构建 Query 查询短语
let queryParts = [];

if (opts.query && opts.query !== '*') {
  let q = opts.query;
  if (!q.includes('"') && !q.includes(':') && !q.includes('AND') && !q.includes('OR')) {
    q = `"${q}"`;
  }
  queryParts.push(q);
}

if (opts.level) {
  queryParts.push(`(loglevel:${opts.level} OR logLevel:${opts.level} OR level:${opts.level})`);
}

if (opts.bltag) {
  queryParts.push(`data_bltag:${opts.bltag}`);
}

if (opts.uri) {
  queryParts.push(`data_uri:"${opts.uri}"`);
}

const finalQueryStr = queryParts.length > 0 ? queryParts.join(' AND ') : '*';

const timeFrom = opts.from ? formatTimeParam(opts.from) : formatTimeParam(opts.time);
const timeTo = opts.to ? formatTimeParam(opts.to) : 'now';

// 微服务环境键推导
const appKeyWithEnv = `${opts.app}:${opts.env}`;
let matchedConfig = serviceCatalog[appKeyWithEnv] || serviceCatalog[opts.app] || serviceCatalog[opts.app.replace(/[:_\-](prod|test|dev)$/, '')];

let targetIndex = opts.index || null;
let targetCluster = opts.cluster || 'https://fast108-kibana-logcenter-intra.intra.ke.com';

if (!targetIndex) {
  if (typeof matchedConfig === 'string') {
    targetIndex = matchedConfig;
  } else if (matchedConfig && typeof matchedConfig === 'object') {
    targetIndex = matchedConfig.index;
    targetCluster = opts.cluster || matchedConfig.cluster || targetCluster;
  } else if (opts.app.startsWith('index-')) {
    targetIndex = opts.app;
  }
}

/**
 * ⚡ 原生 HTTP 直连执行 Kibana ES 检索
 */
async function queryKibanaES(cluster, index, query, fromTime, toTime, limit, offset, sortOrder, timeoutMs) {
  const timeoutSec = Math.max(10, Math.floor(timeoutMs / 1000));
  const payload = {
    params: {
      index: index,
      wait_for_completion_timeout: `${timeoutSec}s`,
      body: {
        size: limit,
        from: offset,
        sort: [
          { timestamp: { order: sortOrder } }
        ],
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
                    lte: toTime
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
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

    const cleanApp = appCode.replace(/[:_\-](prod|test|dev)$/, '');
    const script = `
      async function probe() {
        const task = await useOrCreateTaskSpace('leo-fast-probe');
        try {
          await openOrReuseTab('https://fast.ke.com/#/search', { wait: true, timeout: 12 });
          await click('.el-cascader input');
          await wait(0.4);
          await fillInput('.el-cascader input', ${JSON.stringify(cleanApp)});
          await wait(1.5);
          
          await js(String.raw\`(() => {
            const items = [...document.querySelectorAll('.el-cascader__suggestion-item')];
            const target = items.find(it => it.textContent.includes(${JSON.stringify(cleanApp)}));
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
function renderOutput(targetApp, targetIndex, targetCluster, queryStr, timeFrom, timeTo, esResult, totalCost, isLearned, isHealed, options) {
  const hitsObj = esResult?.rawResponse?.hits || {};
  const totalHits = typeof hitsObj.total === 'object' ? hitsObj.total.value : hitsObj.total || 0;
  let rawHits = hitsObj.hits || [];

  // 根据 options.order 进行排序
  const orderFactor = options.order === 'asc' ? 1 : -1;
  rawHits.sort((a, b) => {
    const tA = (a._source && (a._source.timestamp || a._source['@timestamp'] || a._source.time || a._source.logTime)) || '';
    const tB = (b._source && (b._source.timestamp || b._source['@timestamp'] || b._source.time || b._source.logTime)) || '';
    return tA.localeCompare(tB) * orderFactor;
  });

  const hitList = rawHits.map((h, idx) => {
    const s = h._source || {};
    let msg = s.data_info_msg || s.logDetail || s.data_warn_msg || s.data_err_msg || s.message || 
      (s.data_body ? JSON.stringify({ body: s.data_body, args: s.data_args }) : JSON.stringify(s));

    if (options.slim && typeof msg === 'string' && msg.length > 260) {
      msg = msg.slice(0, 260) + '... [Slim Truncated]';
    }

    return {
      step: idx + 1,
      timestamp: s.timestamp || s['@timestamp'] || s.time || s.logTime,
      logLevel: s.loglevel || s.logLevel || s.level || 'INFO',
      spanId: s.spanId || null,
      bltag: s.data_bltag || null,
      uri: s.data_uri || s.uri || null,
      message: msg,
      tid: s.tid || s.trace_id || null,
      sid: s.sid || null,
      machine: s.machineName || s.host_name || null
    };
  });

  if (options.format === 'brief') {
    console.log(`\n=== 🔎 [${targetApp}] 检索结果 (共 ${totalHits} 条, 展示 ${hitList.length} 条) ===`);
    hitList.forEach(l => {
      console.log(`[#${l.step}] ${l.timestamp} [${l.logLevel}] [${l.uri || l.bltag || '-'}] ${l.tid ? '(' + l.tid + ')' : ''} ${l.message}`);
    });
    console.log(`\n⚡ 耗时: ${totalCost}ms | 集群: ${targetCluster} | 索引: ${targetIndex}\n`);
    return;
  }

  if (options.format === 'table') {
    console.log(`\n=== 🔎 [${targetApp}] 检索结果 (共 ${totalHits} 条, 展示 ${hitList.length} 条) ===`);
    console.table(hitList.map(l => ({
      step: l.step,
      time: l.timestamp?.slice(11, 23),
      level: l.logLevel,
      uri_tag: l.uri || l.bltag || '-',
      tid: l.tid ? l.tid.slice(0, 20) + '...' : '-',
      message: typeof l.message === 'string' ? l.message.slice(0, 80) : ''
    })));
    return;
  }

  const output = {
    summary: {
      targetApp,
      indexPattern: targetIndex,
      kibanaCluster: targetCluster,
      isLearned,
      isHealed,
      query: queryStr,
      order: options.order,
      timeRange: `${timeFrom} ~ ${timeTo}`,
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
      esResult = await queryKibanaES(targetCluster, targetIndex, finalQueryStr, timeFrom, timeTo, finalSize, opts.offset, finalOrder, opts.timeout);
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
      learned = await probeViaEgoBrowser(opts.app);
      if (learned && learned.index) probeType = 'ego-browser';
    }

    // (B) 若 ego-browser 未命中或处于 Windows/Linux 环境，尝试 Chrome 扩展桥接 (Leo Lantern)
    if (!learned || !learned.index) {
      const extLearned = await probeViaLanternExtension(opts.app);
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
      serviceCatalog[opts.app] = { index: targetIndex, cluster: targetCluster };
      saveUserServiceMap(serviceCatalog);

      // 使用最新自愈地址重试直连
      try {
        esResult = await queryKibanaES(targetCluster, targetIndex, finalQueryStr, timeFrom, timeTo, finalSize, opts.offset, finalOrder, opts.timeout);
      } catch (retryErr) {
        console.error(JSON.stringify({
          error: `自愈后重试直连仍失败 (${targetCluster}): ${retryErr.message}`,
          targetApp: opts.app,
          targetIndex,
          targetCluster
        }, null, 2));
        process.exit(1);
      }
    } else {
      // (D) 探针均未能自愈，尝试基于服务名兜底
      if (!targetIndex) {
        targetIndex = opts.app.startsWith('index-') ? opts.app : `${opts.app}*`;
      }
      try {
        esResult = await queryKibanaES(targetCluster, targetIndex, finalQueryStr, timeFrom, timeTo, finalSize, opts.offset, finalOrder, opts.timeout);
      } catch (finalErr) {
        console.error(JSON.stringify({
          error: `查询失败: 未找到微服务 [${opts.app}] 的匹配索引，且智能探针自愈未生效`,
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
  opts.order = finalOrder;
  renderOutput(opts.app, targetIndex, targetCluster, finalQueryStr, timeFrom, timeTo, esResult, totalCost, isLearned, isHealed, opts);
}

main().catch(err => {
  console.error('Execution Error: ' + err.stack);
  process.exit(1);
});
