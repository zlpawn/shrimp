#!/usr/bin/env node

/**
 * 🚀 Leo Live Runner - FAST / Kibana 极速多集群日志与全链路 Trace 检索引擎
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
const CONFIG_FILE = path.join(SHRIMP_SKILLS_DIR, 'config.json');

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

const egoScript = `
async function run() {
  const startTime = Date.now();
  let targetIndex = ${JSON.stringify(targetIndex)};
  let targetCluster = ${JSON.stringify(targetCluster)};
  const targetApp = ${JSON.stringify(targetApp)};
  const queryStr = ${JSON.stringify(queryStr)};
  const timeFrom = ${JSON.stringify(timeFrom)};
  const size = ${size};

  const task = await useOrCreateTaskSpace('leo-fast-log-direct-query');
  const kibanaUrl = targetCluster + '/app/kibana#/discover';
  await openOrReuseTab(kibanaUrl, { wait: true, timeout: 15 });

  // 1. 若未预置，动态探针从 FAST 提取
  let isLearned = false;
  if (!targetIndex) {
    try {
      await openOrReuseTab('https://fast.ke.com/#/search', { wait: true, timeout: 15 });
      await click('.el-cascader input');
      await wait(0.5);
      await fillInput('.el-cascader input', targetApp.replace(/[:_\\-](prod|test|dev)$/, ''));
      await wait(1.5);
      
      const frameInfo = await js(String.raw\`(() => {
        const items = [...document.querySelectorAll('.el-cascader__suggestion-item')];
        const target = items.find(it => it.textContent.includes(${JSON.stringify(targetApp.replace(/[:_\\-](prod|test|dev)$/, ''))}));
        if (target) target.click();
        return true;
      })()\`);
      
      await wait(3);
      const learned = await js(String.raw\`(() => {
        const iframe = document.querySelector('iframe');
        const src = iframe?.src || '';
        const cluster = src.match(/https:\\/\\/[^/]+/)?.[0];
        const index = src.match(/index:'([^']+)'/)?.[1] || src.match(/index%3A%27([^%]+)%27/)?.[1];
        return { cluster, index };
      })()\`);

      if (learned && learned.index) {
        targetIndex = learned.index.includes('*') ? learned.index : learned.index + '*';
        if (learned.cluster) targetCluster = learned.cluster;
        isLearned = true;
        await openOrReuseTab(targetCluster + '/app/kibana#/discover', { wait: true, timeout: 15 });
      }
    } catch (e) {}

    if (!targetIndex) {
      targetIndex = targetApp.startsWith('index-') ? targetApp : targetApp + '*';
    }
  }

  // 2. 执行 ES 底层查询
  const esResult = await js(String.raw\`(() => {
    const payload = {
      params: {
        index: \${JSON.stringify(targetIndex)},
        wait_for_completion_timeout: '10s',
        body: {
          size: \${size},
          query: {
            bool: {
              must: [
                { query_string: { query: \${JSON.stringify(queryStr)}, analyze_wildcard: true } }
              ],
              filter: [
                {
                  range: {
                    timestamp: {
                      gte: \${JSON.stringify(timeFrom)},
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

    return fetch('/internal/search/es', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'kbn-xsrf': 'kibana',
        'kbn-version': '7.7.0'
      },
      body: JSON.stringify(payload)
    }).then(res => res.json());
  })()\`);

  const totalCost = Date.now() - startTime;

  if (!esResult || !esResult.rawResponse) {
    cliLog(JSON.stringify({ error: '查询失败或响应异常', raw: esResult }, null, 2));
    await completeTaskSpace('leo-fast-log-direct-query', { keep: false });
    return;
  }

  const hitsObj = esResult.rawResponse.hits || {};
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
      query: queryStr,
      timeRange: \`\${timeFrom} ~ now\`,
      totalHits,
      returnedCount: hitList.length,
      esQueryTookMs: esResult.rawResponse.took || 0,
      totalCostMs: totalCost
    },
    logs: hitList
  };

  cliLog(JSON.stringify(output, null, 2));
  await completeTaskSpace('leo-fast-log-direct-query', { keep: false });
}

run().catch(err => cliLog('Execution Error: ' + err.stack));
`;

if (targetIndex && !serviceCatalog[targetApp]) {
  serviceCatalog[targetApp] = { index: targetIndex, cluster: targetCluster };
  saveUserServiceMap(serviceCatalog);
}

const child = spawn('ego-browser', ['nodejs'], {
  stdio: ['pipe', 'inherit', 'inherit']
});

child.stdin.write(egoScript);
child.stdin.end();
