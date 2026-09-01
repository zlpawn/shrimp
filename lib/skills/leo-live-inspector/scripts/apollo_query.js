#!/usr/bin/env node

/**
 * 🚀 Leo Live Inspector - Apollo 配置中心极速直连检索引擎
 * 
 * 功能：
 *   1. 秒级免鉴权直连 Apollo ConfigService 读取微服务实时配置；
 *   2. 自动检索 application 与 application.properties 命名空间并智能去重；
 *   3. 支持按 key 关键词精准或模糊过滤；
 *   4. 自动美化解析内嵌 JSON 字符串值；
 *   5. 支持 --json 格式化输出供下游自动化解析。
 */

import http from 'node:http';

const DEFAULT_APOLLO_SERVER = process.env.APOLLO_SERVER_URL || 'http://apollo.configservice.life.ke.com';
const DEFAULT_CLUSTER = 'default';
const COMMON_NAMESPACES = ['application', 'application.properties'];

function printUsage() {
  console.log(`
🔍 Leo Apollo Config Query Tool
用法:
  node scripts/apollo_query.js <appId> [namespace|keyKeyword] [keyKeyword] [options]

参数说明:
  <appId>                 微服务应用 ID (如 zulin-iot-platform, utopia-scs-saas)
  [namespace|keyKeyword]  命名空间 (如 application, application.properties) 或 待检索的 key 关键词
  [keyKeyword]            当第 2 个参数是命名空间时，此参数为 key 关键词

选项 (Options):
  --cluster <cluster>     指定集群 (默认: default)
  --server <url>          指定 Apollo ConfigService 域名 (默认: ${DEFAULT_APOLLO_SERVER})
  --json                  以纯 JSON 格式输出匹配结果
  --exact                 仅精确匹配 key，不使用模糊包含

示例:
  # 1. 查微服务核心配置概览 (默认检索并去重 application / application.properties)
  node scripts/apollo_query.js zulin-iot-platform

  # 2. 跨命名空间检索特定配置 key (如业务开关、超时、白名单)
  node scripts/apollo_query.js zulin-iot-platform lockAuth
  node scripts/apollo_query.js utopia-scs-saas timeout

  # 3. 指定命名空间检索
  node scripts/apollo_query.js zulin-iot-platform application.properties weitang
  node scripts/apollo_query.js zulin-iot-platform application liveRunner
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

  const appId = positionalArgs[0];
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
      appId,
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
  console.log(`🚀 Apollo 配置探查: [${appId}] (集群: ${cluster})`);
  console.log(`🌐 服务器: ${server}`);
  if (keyKeyword) {
    console.log(`🔍 检索关键词: "${keyKeyword}" (${exactMatch ? '精确匹配' : '模糊匹配'})`);
  }
  console.log(`⏱️ 耗时: ${costMs}ms | 扫描配置项: ${totalKeysScanned} 项 | 命中: ${totalMatched} 项`);
  console.log(`================================================================\n`);

  if (Object.keys(finalResults).length === 0) {
    console.log(`⚠️ 未找到匹配的配置项！`);
    if (!targetNamespace) {
      console.log(`💡 提示：默认检索了 [${COMMON_NAMESPACES.join(', ')}]。若该服务使用了特殊命名空间，请显式指定：node scripts/apollo_query.js ${appId} <custom-namespace>`);
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
