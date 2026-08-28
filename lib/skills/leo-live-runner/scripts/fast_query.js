#!/usr/bin/env node

/**
 * 🚀 Leo Live Runner - FAST / Kibana 极速多集群日志与全链路 Trace 检索引擎
 * 
 * ✨ 特性：
 *  - 100% 纯原生 Node.js (内置 fetch)，零外部浏览器依赖；
 *  - 直连内网 Kibana 网关，毫秒级响应 (< 250ms)；
 *  - 智能多集群路由与自动自学习持久化。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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
 * 原生 HTTP 直连执行 Kibana ES 检索
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

  const response = await fetch(`${cluster}/internal/search/es`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'kbn-xsrf': 'kibana',
      'kbn-version': '7.7.0'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 当未配置索引时，纯 Node.js 并发探测常见 Kibana 集群
 */
async function probeIndexAcrossClusters(appCode) {
  const candidateIndex = appCode.startsWith('index-') ? appCode : `${appCode}*`;
  
  const promises = KNOWN_CLUSTERS.map(async (cluster) => {
    try {
      const res = await queryKibanaES(cluster, candidateIndex, '*', 'now-1h', 1);
      const hits = res?.rawResponse?.hits;
      const total = typeof hits?.total === 'object' ? hits.total.value : hits?.total || 0;
      if (total > 0) {
        return { cluster, index: candidateIndex, total };
      }
    } catch (e) {}
    return null;
  });

  const results = await Promise.all(promises);
  return results.find(r => r !== null) || null;
}

async function main() {
  const startTime = Date.now();
  let isLearned = false;

  // 1. 若没有匹配到预设索引，先尝试纯 Node.js 多集群并发探测
  if (!targetIndex) {
    const probed = await probeIndexAcrossClusters(targetApp);
    if (probed) {
      targetCluster = probed.cluster;
      targetIndex = probed.index;
      isLearned = true;
    } else {
      targetIndex = targetApp.startsWith('index-') ? targetApp : `${targetApp}*`;
    }
  }

  // 2. 执行 ES 直连检索
  let esResult;
  try {
    esResult = await queryKibanaES(targetCluster, targetIndex, queryStr, timeFrom, size);
  } catch (err) {
    console.error(JSON.stringify({
      error: `直连检索失败 (${targetCluster}): ${err.message}`,
      targetApp,
      targetIndex,
      targetCluster
    }, null, 2));
    process.exit(1);
  }

  const totalCost = Date.now() - startTime;

  if (!esResult || !esResult.rawResponse) {
    console.log(JSON.stringify({ error: '查询失败或响应异常', raw: esResult }, null, 2));
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
      timeRange: `${timeFrom} ~ now`,
      totalHits,
      returnedCount: hitList.length,
      esQueryTookMs: esResult.rawResponse.took || 0,
      totalCostMs: totalCost
    },
    logs: hitList
  };

  // 若成功定位到新索引，持久化自学习结果
  if (isLearned && targetIndex && !serviceCatalog[targetApp]) {
    serviceCatalog[targetApp] = { index: targetIndex, cluster: targetCluster };
    saveUserServiceMap(serviceCatalog);
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Execution Error: ' + err.stack);
  process.exit(1);
});
