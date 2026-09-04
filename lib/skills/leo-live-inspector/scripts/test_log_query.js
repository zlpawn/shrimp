#!/usr/bin/env node

/**
 * ⚡ Leo Live Inspector - 测试环境容器与泳道日志 (Paoding Loki) 极速直连检索引擎
 * 
 * 核心特性：
 *   1. 纯 HTTP 毫秒级直连：直连 Paoding Loki 网关，单次查询 50ms~100ms，无需等待浏览器渲染；
 *   2. 全环境自动漫游：同时支持服务云标准容器与大禹平台多泳道 Pod（如 lixiaojing02 / lixiaojing03）；
 *   3. 丰富过滤组合：支持时间范围 (--time / --from / --to)、级别过滤 (--level)、关键词 (-q) 与 TraceId 精准回溯；
 *   4. 凭证自愈与静默持久化：自动读取 ~/.shrimp/skills/live-inspector/paoding_cookie.json，支持 ego-browser 自动补足；
 *   5. 高可读性呈现：结构化终端表格、Trace 链路日志与 --json 模式。
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { resolveAppId } from './common/services.js';
import { SHRIMP_LIVE_DIR, loadPaodingCookie, savePaodingCookie } from './common/credentials.js';

const COOKIE_FILE = path.join(SHRIMP_LIVE_DIR, 'paoding_cookie.json');
const LOKI_QUERY_URL = 'https://paoding.ke.com/api/ds/query?ds_type=loki';
const LOKI_DATASOURCE_UID = 'd5141ff6-e1e8-4e8d-ba6f-6dcb1e356fdc';

function postJson(urlStr, payload, cookieStr) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(payload);

    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Cookie': cookieStr,
        'Content-Length': Buffer.byteLength(bodyStr)
      },
      timeout: 10000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode === 302 || (res.headers.location && res.headers.location.includes('login.ke.com'))) {
          return resolve({ success: false, isRedirect: true, statusCode: res.statusCode });
        }
        try {
          const json = JSON.parse(raw);
          resolve({ success: true, data: json, statusCode: res.statusCode });
        } catch (e) {
          resolve({ success: false, raw, statusCode: res.statusCode, error: e.message });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout (10000ms)' });
    });

    req.write(bodyStr);
    req.end();
  });
}

function printUsage() {
  console.log(`
⚡ Leo Test Log Query (测试环境容器与泳道日志极速直连引擎)

用法:
  node scripts/test_log_query.js <appId> [options]

参数说明:
  <appId>               微服务别名 (如 saas, algo, recorder, warehouse, iot)
  -q, --query <str>     关键词过滤短语 (如 -q "Exception" 或 -q "door")
  -l, --level <lvl>     日志级别过滤: ERROR, WARN, INFO, DEBUG
  --tid, --traceId <id> TraceId 精准过滤与调用链回溯
  -t, --time <range>    时间范围，默认 1h (如 15m, 30m, 1h, 2h, 24h)
  --from <time>         起始时间 (支持相对时间或时间戳)
  --to <time>           结束时间 (默认 now)
  --lane, --ns <name>   指定大禹泳道名或命名空间 (如 lixiaojing02, lixiaojing03)
  --pod <podName>       指定 Pod 实例名称
  -n, --size <limit>    最大返回日志条数 (默认 20，Trace 模式默认 50)
  --format <fmt>        输出格式: table (默认表格), brief (紧凑文本), json
  --slim                瘦身模式，截断超长堆栈或报文
  --set-cookie <str>    保存更新 Paoding 登录 Cookie 凭证
  -h, --help            显示帮助信息

示例:
  # 查 SaaS 服务测试环境最新 10 条日志
  node scripts/test_log_query.js saas -n 10

  # 查大禹部署的算法模块 500/ERROR 异常
  node scripts/test_log_query.js algo --level ERROR -t 30m

  # 指定大禹泳道 lixiaojing03 检索
  node scripts/test_log_query.js algo --lane lixiaojing03 -n 5

  # 根据 TraceId 追溯测试环境完整请求链
  node scripts/test_log_query.js warehouse --traceId "search-event-builder-10.238.223.125-..."
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  // 1. 设置 Cookie
  const setCookieIdx = args.findIndex(a => a === '--set-cookie');
  if (setCookieIdx !== -1 && args[setCookieIdx + 1]) {
    savePaodingCookie(args[setCookieIdx + 1]);
    console.log(`✅ 已成功保存 Paoding Cookie 凭证至本地缓存: ${COOKIE_FILE}`);
    process.exit(0);
  }

  let appArg = '';
  let queryStr = '';
  let level = '';
  let traceId = '';
  let timeRange = '1h';
  let timeFrom = null;
  let timeTo = 'now';
  let lane = '';
  let podName = '';
  let size = 0;
  let format = 'table';
  let slim = false;
  let customCookie = '';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-a' || a === '--app') {
      appArg = args[++i];
    } else if (a === '-q' || a === '--query') {
      queryStr = args[++i];
    } else if (a === '-l' || a === '--level') {
      level = args[++i].toUpperCase();
    } else if (a === '--tid' || a === '--traceId') {
      traceId = args[++i];
    } else if (a === '-t' || a === '--time') {
      timeRange = args[++i];
    } else if (a === '--from') {
      timeFrom = args[++i];
    } else if (a === '--to') {
      timeTo = args[++i];
    } else if (a === '--lane' || a === '--ns' || a === '--namespace') {
      lane = args[++i];
    } else if (a === '--pod') {
      podName = args[++i];
    } else if (a === '-n' || a === '--size' || a === '--limit') {
      size = parseInt(args[++i], 10);
    } else if (a === '-f' || a === '--format') {
      format = args[++i].toLowerCase();
    } else if (a === '--slim') {
      slim = true;
    } else if (a === '--cookie') {
      customCookie = args[++i];
    } else if (!a.startsWith('-')) {
      if (!appArg) appArg = a;
      else if (!queryStr) queryStr = a;
    }
  }

  if (!appArg && !podName) {
    console.error(`❌ 请指定目标微服务名称 (如 saas, algo, warehouse)！`);
    printUsage();
    process.exit(1);
  }

  const canonicalApp = resolveAppId(appArg);
  if (!size) {
    size = traceId ? 50 : 20;
  }

  // 处理时间参数
  if (!timeFrom) {
    timeFrom = `now-${timeRange}`;
  }

  // 组装 LogQL 表达式
  let selector = '';
  if (podName) {
    selector = `{pod_name="${podName}"}`;
  } else if (lane) {
    selector = `{pod_namespace="${lane}", pod_name=~".*${canonicalApp}.*"}`;
  } else {
    selector = `{pod_name=~".*${canonicalApp}.*"}`;
  }

  let expr = selector;
  if (level) {
    expr += ` |= "${level}"`;
  }
  if (traceId) {
    expr += ` |= "${traceId}"`;
  }
  if (queryStr && queryStr !== '*') {
    expr += ` |= "${queryStr}"`;
  }

  const cookie = customCookie || loadPaodingCookie();
  if (!cookie) {
    console.error(`\n❌ 未找到 Paoding 登录 Cookie 凭证！`);
    console.error(`💡 获取指引：`);
    console.error(`   1. 打开已登录的 https://paoding.ke.com 页面；`);
    console.error(`   2. 点击右上角 Leo Cookie 插件复制 Cookie，或按 F12 复制 security_ticket / login_ucid；`);
    console.error(`   3. 运行: node scripts/test_log_query.js --set-cookie "<粘贴的Cookie>"\n`);
    process.exit(1);
  }

  const payload = {
    queries: [
      {
        refId: 'A',
        datasource: { type: 'loki', uid: LOKI_DATASOURCE_UID },
        editorMode: 'code',
        expr: expr,
        queryType: 'range',
        maxLines: size
      }
    ],
    from: timeFrom,
    to: timeTo
  };

  const startTime = Date.now();
  const res = await postJson(LOKI_QUERY_URL, payload, cookie);
  const costMs = Date.now() - startTime;

  if (res.isRedirect) {
    console.error(`\n❌ Paoding Cookie 已过期（服务端已重定向至登录页）！`);
    console.error(`💡 请刷新并重新登录 https://paoding.ke.com 后，运行: node scripts/test_log_query.js --set-cookie "<新Cookie>"\n`);
    process.exit(1);
  }

  if (!res.success || !res.data) {
    console.error(`\n❌ 查询请求失败: ${res.error || `HTTP ${res.statusCode}`}`);
    process.exit(1);
  }

  const frame = res.data.results?.A?.frames?.[0];
  const labelsArr = frame?.data?.values?.[0] || [];
  const timesArr = frame?.data?.values?.[1] || [];
  const linesArr = frame?.data?.values?.[2] || [];

  const hitCount = linesArr.length;

  if (format === 'json') {
    const logs = [];
    for (let i = 0; i < hitCount; i++) {
      logs.push({
        timestamp: timesArr[i],
        labels: labelsArr[i] || {},
        line: linesArr[i]
      });
    }
    console.log(JSON.stringify({
      service: canonicalApp,
      expr,
      timeRange: `${timeFrom} ~ ${timeTo}`,
      costMs,
      hitCount,
      logs
    }, null, 2));
    return;
  }

  console.log(`================================================================`);
  console.log(`🚀 Leo 测试环境容器日志检索: ${canonicalApp}`);
  console.log(`🔎 表达式: ${expr}`);
  console.log(`⏱️ 时间跨度: ${timeFrom} ~ ${timeTo} | 耗时: ${costMs}ms | 命中: ${hitCount} 条`);
  console.log(`================================================================\n`);

  if (hitCount === 0) {
    console.log(`⚠️ 未检索到匹配的容器日志。\n`);
    return;
  }

  // 格式化展示
  const parsedLogs = [];
  for (let i = 0; i < hitCount; i++) {
    const rawLine = linesArr[i] || '';
    const label = labelsArr[i] || {};
    const tStr = timesArr[i] ? new Date(timesArr[i]).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
    
    // 提取日志级别
    let lvl = 'INFO';
    if (rawLine.includes('ERROR')) lvl = 'ERROR';
    else if (rawLine.includes('WARN')) lvl = 'WARN';
    else if (rawLine.includes('DEBUG')) lvl = 'DEBUG';

    // 提取 TID
    const tidMatch = rawLine.match(/\[TID:([^\]]+)\]/) || rawLine.match(/"tid":"([^"]+)"/);
    const tid = tidMatch && tidMatch[1] !== 'N/A' ? tidMatch[1] : '';

    // 提取主要文本
    let lineContent = rawLine;
    if (slim && lineContent.length > 200) {
      lineContent = lineContent.slice(0, 200) + '... [Slim Truncated]';
    }

    parsedLogs.push({
      step: i + 1,
      time: tStr,
      pod: label.pod_name || '-',
      lane: label.pod_namespace || '-',
      level: lvl,
      tid: tid ? (tid.length > 22 ? tid.slice(0, 22) + '...' : tid) : '-',
      content: lineContent
    });
  }

  if (format === 'brief') {
    for (const l of parsedLogs) {
      console.log(`[#${l.step}] ${l.time} [${l.lane}/${l.pod}] [${l.level}] ${l.tid !== '-' ? `(TID:${l.tid})` : ''} ${l.content}`);
    }
    console.log(``);
    return;
  }

  // 表格展示
  console.log(`| # | 时间 | 泳道/命名空间 | Pod 实例名 | 级别 | TraceId | 日志内容摘录 |`);
  console.log(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
  for (const l of parsedLogs) {
    const cleanContent = l.content.replace(/[\n\r]+/g, ' ').replace(/\|/g, '\\|');
    const displaySnippet = cleanContent.length > 85 ? cleanContent.slice(0, 85) + '...' : cleanContent;
    console.log(`| ${l.step} | ${l.time} | ${l.lane} | ${l.pod} | ${l.level} | ${l.tid} | ${displaySnippet} |`);
  }
  console.log(``);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
