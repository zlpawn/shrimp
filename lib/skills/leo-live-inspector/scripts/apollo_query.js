#!/usr/bin/env node

/**
 * 🚀 Leo Live Inspector - Apollo 配置中心极速直连检索引擎
 * 
 * 功能：
 *   1. 秒级免鉴权直连 Apollo ConfigService 读取微服务实时配置；
 *   2. 智能服务别名与模糊匹配解析（如 platform -> zulin-iot-platform）；
 *   3. 自动检索 application 与 application.properties 命名空间并智能去重；
 *   4. 支持按 key 关键词精准或模糊过滤；
 *   5. 自动美化解析内嵌 JSON 字符串值；
 *   6. 支持 --json 格式化输出供下游自动化解析。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRESET_RESOURCE_FILE = path.join(__dirname, '..', 'resources', 'default_services.json');
const USER_SERVICE_MAP_FILE = path.join(os.homedir(), '.shrimp', 'skills', 'live-runner', 'service_map.json');

const DEFAULT_APOLLO_SERVER = process.env.APOLLO_SERVER_URL || 'http://apollo.configservice.life.ke.com';
const DEFAULT_CLUSTER = 'default';
const COMMON_NAMESPACES = ['application', 'application.properties'];

// 常见业务别名与口语缩写硬编码映射
const HARDCODED_ALIASES = {
  'platform': 'zulin-iot-platform',
  'iot-platform': 'zulin-iot-platform',
  'iot': 'zulin-iot-platform',
  '房源': 'zulin-iot-platform',
  '门锁': 'zulin-iot-platform',
  'saas': 'utopia-scs-saas',
  'scs': 'utopia-scs-saas',
  '品控saas': 'utopia-scs-saas',
  '智慧工地saas': 'utopia-scs-saas',
  'recorder': 'utopia-scs-recorder',
  '记录仪': 'utopia-scs-recorder',
  '头戴式记录仪': 'utopia-scs-recorder',
  '品控头戴式记录仪': 'utopia-scs-recorder',
  '临境记录仪': 'utopia-scs-recorder',
  'adaptor': 'zulin-iot-device-adaptor',
  'device-adaptor': 'zulin-iot-device-adaptor',
  'warehouse': 'beijia-iot-warehouse',
  'iot-warehouse': 'beijia-iot-warehouse',
  'finance': 'iot-erp-finance',
  'erp': 'iot-erp-core'
};

function loadServiceCatalog() {
  let presetMap = {};
  if (fs.existsSync(PRESET_RESOURCE_FILE)) {
    try {
      presetMap = JSON.parse(fs.readFileSync(PRESET_RESOURCE_FILE, 'utf8'));
    } catch (e) {}
  }
  let userMap = {};
  if (fs.existsSync(USER_SERVICE_MAP_FILE)) {
    try {
      userMap = JSON.parse(fs.readFileSync(USER_SERVICE_MAP_FILE, 'utf8'));
    } catch (e) {}
  }
  return { ...presetMap, ...userMap };
}

function printUsage() {
  console.log(`
🔍 Leo Apollo Config Query Tool
用法:
  node scripts/apollo_query.js <appId|alias> [namespace|keyKeyword] [keyKeyword] [options]

参数说明:
  <appId|alias>           微服务应用 ID 或常见简称/别名 (如 platform, iot, saas, zulin-iot-platform)
  [namespace|keyKeyword]  命名空间 (如 application, application.properties) 或 待检索的 key 关键词
  [keyKeyword]            当第 2 个参数是命名空间时，此参数为 key 关键词

选项 (Options):
  --cluster <cluster>     指定集群 (默认: default)
  --server <url>          指定 Apollo ConfigService 域名 (默认: ${DEFAULT_APOLLO_SERVER})
  --json                  以纯 JSON 格式输出匹配结果
  --exact                 仅精确匹配 key，不使用模糊包含

示例:
  # 1. 口语化简称自动映射查询 (如 platform 自动解析为 zulin-iot-platform)
  node scripts/apollo_query.js platform lockAuth
  node scripts/apollo_query.js saas timeout

  # 2. 查微服务全部配置概览 (默认检索并去重 application / application.properties)
  node scripts/apollo_query.js zulin-iot-platform

  # 3. 指定命名空间检索
  node scripts/apollo_query.js zulin-iot-platform application.properties weitang
`);
}

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ success: false, statusCode: res.statusCode });
      }
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve({ success: true, data: parsed, statusCode: 200 });
        } catch (e) {
          resolve({ success: false, error: e.message, statusCode: 200 });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout (4000ms)' });
    });
  });
}

function tryParseJson(str) {
  if (typeof str !== 'string') return str;
  const trimmed = str.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return str;
    }
  }
  return str;
}

function areObjectsEqual(objA, objB) {
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (objA[k] !== objB[k]) return false;
  }
  return true;
}

/**
 * 智能别名与模糊匹配解析器
 */
async function resolveAppId(inputApp, server, cluster) {
  const catalog = loadServiceCatalog();
  const lowerInput = inputApp.toLowerCase();

  // 1. 字典显式标记 realAppId
  if (catalog[inputApp] && catalog[inputApp].realAppId) {
    return { resolvedAppId: catalog[inputApp].realAppId, original: inputApp, reason: 'preset_alias' };
  }
  if (catalog[lowerInput] && catalog[lowerInput].realAppId) {
    return { resolvedAppId: catalog[lowerInput].realAppId, original: inputApp, reason: 'preset_alias' };
  }

  // 2. 查内置别名表
  if (HARDCODED_ALIASES[lowerInput]) {
    return { resolvedAppId: HARDCODED_ALIASES[lowerInput], original: inputApp, reason: 'hardcoded_alias' };
  }

  // 3. 直接验证原名是否在 Apollo 存在
  const directCheck = await fetchJson(`${server.replace(/\/+$/, '')}/configfiles/json/${encodeURIComponent(inputApp)}/${encodeURIComponent(cluster)}/application`);
  if (directCheck.success) {
    return { resolvedAppId: inputApp, original: inputApp, reason: 'exact_match' };
  }

  // 4. 若原名返回 404，进行子串模糊搜索与在线探活
  const catalogKeys = Object.keys(catalog);
  const candidates = new Set();

  for (const k of catalogKeys) {
    const realId = (catalog[k] && catalog[k].realAppId) || k;
    if (k.toLowerCase().includes(lowerInput) || realId.toLowerCase().includes(lowerInput)) {
      candidates.add(realId);
    }
  }

  for (const cand of candidates) {
    if (cand === inputApp) continue;
    const probe = await fetchJson(`${server.replace(/\/+$/, '')}/configfiles/json/${encodeURIComponent(cand)}/${encodeURIComponent(cluster)}/application`);
    if (probe.success) {
      return { resolvedAppId: cand, original: inputApp, reason: 'fuzzy_probe' };
    }
  }

  return { resolvedAppId: inputApp, original: inputApp, reason: 'fallback' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  // 解析 options
  let cluster = DEFAULT_CLUSTER;
  let server = DEFAULT_APOLLO_SERVER;
  let outputJson = false;
  let exactMatch = false;

  const positionalArgs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cluster' && args[i + 1]) {
      cluster = args[++i];
    } else if (arg === '--server' && args[i + 1]) {
      server = args[++i];
    } else if (arg === '--json') {
      outputJson = true;
    } else if (arg === '--exact') {
      exactMatch = true;
    } else if (!arg.startsWith('-')) {
      positionalArgs.push(arg);
    }
  }

  const inputApp = positionalArgs[0];
  let targetNamespace = null;
  let keyKeyword = null;

  if (positionalArgs.length === 2) {
    const secondArg = positionalArgs[1];
    if (secondArg.includes('.') || secondArg.toLowerCase() === 'application' || secondArg.toLowerCase() === 'default') {
      targetNamespace = secondArg;
    } else {
      keyKeyword = secondArg;
    }
  } else if (positionalArgs.length >= 3) {
    targetNamespace = positionalArgs[1];
    keyKeyword = positionalArgs[2];
  }

  // 执行智能服务别名解析
  const { resolvedAppId, reason } = await resolveAppId(inputApp, server, cluster);
  const appId = resolvedAppId;

  const isAutoNamespaces = !targetNamespace;
  const namespacesToQuery = targetNamespace ? [targetNamespace] : COMMON_NAMESPACES;
  const startTime = Date.now();

  const rawResults = {};
  let totalKeysScanned = 0;
  let totalMatched = 0;

  for (const ns of namespacesToQuery) {
    const url = `${server.replace(/\/+$/, '')}/configfiles/json/${encodeURIComponent(appId)}/${encodeURIComponent(cluster)}/${encodeURIComponent(ns)}`;
    const res = await fetchJson(url);
    if (!res.success) {
      if (res.statusCode === 404) {
        continue;
      }
      if (!outputJson) {
        console.warn(`⚠️ 命名空间 [${ns}] 查询失败: ${res.error || `HTTP ${res.statusCode}`}`);
      }
      continue;
    }

    const configMap = res.data || {};
    const matchedEntries = {};
    const keys = Object.keys(configMap);
    totalKeysScanned += keys.length;

    for (const key of keys) {
      let isMatch = true;
      if (keyKeyword) {
        if (exactMatch) {
          isMatch = (key === keyKeyword);
        } else {
          isMatch = key.toLowerCase().includes(keyKeyword.toLowerCase());
        }
      }

      if (isMatch) {
        matchedEntries[key] = configMap[key];
        totalMatched++;
      }
    }

    if (Object.keys(matchedEntries).length > 0) {
      rawResults[ns] = matchedEntries;
    }
  }

  // 智能去重：如果在自动模式下，application.properties 与 application 返回内容完全一致，合并展示
  const finalResults = {};
  if (isAutoNamespaces && rawResults['application'] && rawResults['application.properties']) {
    if (areObjectsEqual(rawResults['application'], rawResults['application.properties'])) {
      finalResults['application / application.properties'] = rawResults['application'];
      totalMatched = Object.keys(rawResults['application']).length;
    } else {
      Object.assign(finalResults, rawResults);
    }
  } else {
    Object.assign(finalResults, rawResults);
  }

  const costMs = Date.now() - startTime;

  if (outputJson) {
    console.log(JSON.stringify({
      inputApp,
      resolvedAppId: appId,
      resolvedReason: reason,
      cluster,
      server,
      costMs,
      totalKeysScanned,
      totalMatched,
      results: finalResults
    }, null, 2));
    return;
  }

  // 格式化终端输出
  console.log(`================================================================`);
  if (appId !== inputApp) {
    console.log(`🚀 Apollo 配置探查: [${appId}] ℹ️ (由别名 "${inputApp}" 自动映射)`);
  } else {
    console.log(`🚀 Apollo 配置探查: [${appId}]`);
  }
  console.log(`🌐 服务器: ${server} (集群: ${cluster})`);
  if (keyKeyword) {
    console.log(`🔍 检索关键词: "${keyKeyword}" (${exactMatch ? '精确匹配' : '模糊匹配'})`);
  }
  console.log(`⏱️ 耗时: ${costMs}ms | 扫描配置项: ${totalKeysScanned} 项 | 命中: ${totalMatched} 项`);
  console.log(`================================================================\n`);

  if (Object.keys(finalResults).length === 0) {
    console.log(`⚠️ 未找到匹配的配置项！`);
    if (!targetNamespace) {
      console.log(`💡 提示：默认检索了 [${COMMON_NAMESPACES.join(', ')}]。若该服务使用了特殊命名空间，请显式指定：node scripts/apollo_query.js ${inputApp} <custom-namespace>`);
    }
    return;
  }

  for (const [ns, configs] of Object.entries(finalResults)) {
    const keys = Object.keys(configs);
    console.log(`📁 命名空间: 【${ns}】 (共 ${keys.length} 项)`);
    console.log(`----------------------------------------------------------------`);

    for (const key of keys) {
      const val = configs[key];
      const parsedVal = tryParseJson(val);

      console.log(`🔑 Key:   ${key}`);
      if (typeof parsedVal === 'object' && parsedVal !== null) {
        console.log(`📄 Value (JSON):`);
        console.log(JSON.stringify(parsedVal, null, 2).split('\n').map(line => '    ' + line).join('\n'));
      } else {
        console.log(`📄 Value: ${val}`);
      }
      console.log(``);
    }
  }
}

main().catch(err => {
  console.error('执行异常:', err);
  process.exit(1);
});
