#!/usr/bin/env node

/**
 * 🗄️ Leo Live Inspector - 服务云 MySQL 自助查询引擎 (Cloud MySQL Query Engine)
 * 
 * 功能：
 *   1. 免本地安装 MySQL/VPN，免鉴权直连服务云 DQL 网关执行只读 SQL 查询；
 *   2. 支持读取本地持久化 Token (~/.shrimp/skills/live-inspector/cloud_token.json)；
 *   3. 智能微服务简称映射 (如 recorder -> port: 6763, db: utopia_scs_recorder)；
 *   4. 自动解析服务端返回的 Base64 Excel 数据流并格式化为精美终端表格 / JSON；
 *   5. 内置 Token 引导与一键配置 (--set-token <token>)。
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.join(os.homedir(), '.shrimp', 'skills', 'live-inspector');
const TOKEN_FILE = path.join(CONFIG_DIR, 'cloud_token.json');
const CATALOG_FILE = path.join(CONFIG_DIR, 'db_catalog.json');
const PRESET_RESOURCE_FILE = path.join(__dirname, '..', 'resources', 'default_services.json');
const USER_SERVICE_MAP_FILE = path.join(os.homedir(), '.shrimp', 'skills', 'live-runner', 'service_map.json');

// 从 default_services.json 与 ~/.shrimp/skills/live-runner/service_map.json 动态加载服务到端口和库名的映射
function loadPresetServiceDbMapping() {
  const mapping = {};
  
  // 1. 读取预制资源 default_services.json
  if (fs.existsSync(PRESET_RESOURCE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(PRESET_RESOURCE_FILE, 'utf8'));
      for (const [key, val] of Object.entries(data)) {
        if (val.port && val.database) {
          mapping[key.toLowerCase()] = {
            port: String(val.port),
            database: val.database,
            role: 'Slave',
            name: val.dbDesc || key
          };
        }
      }
    } catch {}
  }

  // 2. 读取用户级新增/学习的 ~/.shrimp/skills/live-runner/service_map.json 并合并覆盖
  if (fs.existsSync(USER_SERVICE_MAP_FILE)) {
    try {
      const userData = JSON.parse(fs.readFileSync(USER_SERVICE_MAP_FILE, 'utf8'));
      for (const [key, val] of Object.entries(userData)) {
        if (val.port && val.database) {
          mapping[key.toLowerCase()] = {
            port: String(val.port),
            database: val.database,
            role: 'Slave',
            name: val.dbDesc || key
          };
        }
      }
    } catch {}
  }

  return mapping;
}

const SERVICE_DB_MAPPING = loadPresetServiceDbMapping();

function getJson(urlStr, token) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    https.get({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      headers: {
        'Cookie': `cloud_console_token_egg=${token};`,
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 6000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
  });
}

async function fetchDbCatalog(token) {
  const portsRes = await getJson('https://cloud.intra.ke.com/cloud-proxy-api/xmen/mysql/dql/query_port', token);
  const ports = portsRes?.data || [];
  const catalog = [];
  for (const p of ports) {
    const dbRes = await getJson(`https://cloud.intra.ke.com/cloud-proxy-api/xmen/mysql/dql/query_database?port=${p}`, token);
    const dbs = dbRes?.data || [];
    for (const db of dbs) {
      catalog.push({ port: String(p), database: db });
    }
  }
  if (catalog.length > 0) {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CATALOG_FILE, JSON.stringify({
      updated_at: new Date().toISOString(),
      list: catalog
    }, null, 2), 'utf8');
  }
  return catalog;
}

async function loadDbCatalog(token, forceRefresh = false) {
  if (!forceRefresh && fs.existsSync(CATALOG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
      if (Array.isArray(data.list) && data.list.length > 0) {
        // 如果文件少于 24 小时则直接复用
        const ageHours = (Date.now() - new Date(data.updated_at).getTime()) / (1000 * 3600);
        if (ageHours < 24) return data.list;
      }
    } catch {}
  }
  if (token) {
    return await fetchDbCatalog(token);
  }
  return [];
}

function printTokenGuide() {
  const extPath = fs.existsSync(path.join(os.homedir(), '.agents', 'skills', 'leo-live-inspector', 'resources', 'chrome_extension'))
    ? path.join(os.homedir(), '.agents', 'skills', 'leo-live-inspector', 'resources', 'chrome_extension')
    : path.join(__dirname, '..', 'resources', 'chrome_extension');

  console.log(`
================================================================
🔑 如何获取服务云 Token 凭证？（提供两种极简方式）：
================================================================

【方式 1：最推荐】安装内置 Chrome 插件（0 门槛、一键复制/免网关下载）
----------------------------------------------------------------
1. 在 Mac 终端运行一键引导命令（自动复制路径并打开 Chrome 扩展页）：
   bash ${path.join(__dirname, 'setup_chrome_ext.sh')}

2. 或者手动在 Chrome 打开: chrome://extensions/
   - 开启右上角【开发者模式 (Developer mode)】；
   - 点击左上角【加载已解压的扩展程序 (Load unpacked)】；
   - 粘贴此路径确定: ${extPath}

3. 切回服务云页面 (https://cloud.intra.ke.com/database/mysql/self-check)；
   - 点击插件图标，点击【复制】单项 Token 或【📥 下载 cookies.txt】即可！

----------------------------------------------------------------
【方式 2：备用】使用浏览器开发者工具 F12 手动复制（无需装插件）
----------------------------------------------------------------
1. 在 Chrome 打开服务云页面: https://cloud.intra.ke.com/database/mysql/self-check
2. 按 F12 打开控制台 ➔ 顶部【Application (应用)】➔ 左侧【Cookies】➔ 点击【cloud.intra.ke.com】；
3. 找到名为【cloud_console_token_egg】的那一行，双击 Value 复制；
4. 运行配置命令:
   node scripts/cloud_mysql_query.js --set-token <你复制的token>
================================================================
`);
}

function parseNetscapeCookieText(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length >= 7) {
      const name = parts[5].trim();
      const value = parts[6].trim();
      if (name === 'cloud_console_token_egg') {
        return value;
      }
    }
  }
  return null;
}

function loadToken() {
  if (process.env.CLOUD_MYSQL_TOKEN) {
    return process.env.CLOUD_MYSQL_TOKEN.trim();
  }

  // 1. 优先检测插件导出到本地网关的 cookies 文件 (cookies-cloud.intra.ke.com.txt 等)
  const candidateFiles = [
    path.join(process.cwd(), 'cookies-cloud.intra.ke.com.txt'),
    path.join(process.cwd(), 'cookies.txt'),
    path.join(os.homedir(), 'Downloads', 'cookies-cloud.intra.ke.com.txt'),
    path.join(os.homedir(), 'Downloads', 'cookies.txt')
  ];

  for (const file of candidateFiles) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const token = parseNetscapeCookieText(content);
        if (token) {
          // 自动同步刷入标准配置
          saveToken(token);
          return token;
        }
      } catch (e) {}
    }
  }

  // 2. 检查本地持久化配置文件
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (data.cloud_console_token_egg) {
        return data.cloud_console_token_egg.trim();
      }
    } catch (e) {}
  }
  return null;
}

function saveToken(token) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  let cleanToken = token.trim();
  if (cleanToken.includes('cloud_console_token_egg=')) {
    const match = cleanToken.match(/cloud_console_token_egg=([^;]+)/);
    if (match) cleanToken = match[1].trim();
  } else {
    cleanToken = cleanToken.replace(/;.*$/, '').trim();
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({
    cloud_console_token_egg: cleanToken,
    updated_at: new Date().toISOString()
  }, null, 2), 'utf8');
  console.log(`✅ Token 已成功保存至: ${TOKEN_FILE} (${cleanToken.slice(0, 16)}...)`);
}

function parseXlsxBase64WithPython(b64Data) {
  const pyCode = `
import sys, base64, io, zipfile, json
import xml.etree.ElementTree as ET

try:
    b64_str = sys.stdin.read().strip()
    zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64_str)))
    shared_strings = []
    if 'xl/sharedStrings.xml' in zf.namelist():
        tree = ET.fromstring(zf.read('xl/sharedStrings.xml'))
        for si in tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
            t = si.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
            shared_strings.append(t.text if t is not None and t.text else '')

    tree = ET.fromstring(zf.read('xl/worksheets/sheet1.xml'))
    rows = []
    for r in tree.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
        row_vals = []
        for c in r.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
            t_type = c.get('t')
            v = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
            val = v.text if v is not None else ''
            if t_type == 's' and val.isdigit():
                idx = int(val)
                val = shared_strings[idx] if idx < len(shared_strings) else val
            row_vals.append(val)
        if any(row_vals):
            rows.append(row_vals)
    print(json.dumps(rows, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

  const child = spawnSync('python3', ['-c', pyCode], {
    input: b64Data,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });

  if (child.error) {
    return { error: child.error.message };
  }
  try {
    return JSON.parse(child.stdout);
  } catch (err) {
    return { error: 'Failed to parse python json output: ' + child.stdout };
  }
}

function postJson(urlStr, payload, token) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'Cookie': `cloud_console_token_egg=${token};`,
        'Content-Length': Buffer.byteLength(bodyStr)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        if (res.statusCode === 302 || (res.headers.location && res.headers.location.includes('login.ke.com'))) {
          return resolve({ success: false, isRedirect: true, statusCode: res.statusCode });
        }
        try {
          const json = JSON.parse(rawData);
          resolve({ success: true, data: json, statusCode: res.statusCode });
        } catch (e) {
          resolve({ success: false, raw: rawData, statusCode: res.statusCode, error: e.message });
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
🔍 Leo Cloud MySQL Query Tool (服务云 MySQL 自助查询引擎)
用法:
  node scripts/cloud_mysql_query.js <appId|port> [database|sql] [sql] [options]

参数说明:
  <appId|port>     微服务别名 (如 recorder, saas, algo) 或 数据库端口号 (如 6763)
  [database|sql]   库名 (如 utopia_scs_recorder) 或 待执行的 SQL 语句 (当第 1 个参数是服务别名时)
  [sql]            当传入端口和库名时，第 3 个参数为待执行的 SQL 语句

选项 (Options):
  --set-token <token>   配置/更新服务云 cloud_console_token_egg 凭证
  --port <port>         指定端口号 (默认自动根据服务映射解析)
  --db <database>       指定库名
  --role <role>         角色: Slave (默认从库只读) 或 Master (主库)
  --token <token>       单次临时覆盖 Token
  --json                以纯 JSON 格式输出匹配结果
  --table               以控制台对齐表格输出 (默认)

示例:
  # 1. 首次配置 Token (只需贴一次，保存后长期有效)
  node scripts/cloud_mysql_query.js --set-token 2.0111a9beb284238b...

  # 2. 口语化通过服务简称查表数据 (自动解析为对应端口和库名)
  node scripts/cloud_mysql_query.js recorder "SELECT id, ctime FROM image_understanding_detail ORDER BY id DESC LIMIT 5"

  # 3. 指定端口与库名查询
  node scripts/cloud_mysql_query.js 6763 utopia_scs_recorder "SELECT count(*) FROM image_understanding_detail"
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  // 1. 设置 token
  const setTokenIdx = args.findIndex(a => a === '--set-token');
  if (setTokenIdx !== -1 && args[setTokenIdx + 1]) {
    saveToken(args[setTokenIdx + 1]);
    process.exit(0);
  }

  let customPort = null;
  let customDb = null;
  let customRole = 'Slave';
  let tempToken = null;
  let outputJson = false;

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      customPort = args[++i];
    } else if ((arg === '--db' || arg === '--database') && args[i + 1]) {
      customDb = args[++i];
    } else if (arg === '--role' && args[i + 1]) {
      customRole = args[++i];
    } else if (arg === '--token' && args[i + 1]) {
      tempToken = args[++i];
    } else if (arg === '--json') {
      outputJson = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  const token = tempToken || loadToken();
  if (!token) {
    console.error(`❌ 未检测到服务云凭证 (cloud_console_token_egg)！`);
    printTokenGuide();
    process.exit(1);
  }

  // 2. 列出所有数据库资产
  if (args.includes('--list-dbs') || args.includes('--catalog')) {
    const catalog = await loadDbCatalog(token, args.includes('--refresh'));
    console.log(`\n📚 服务云当前工号已授权数据库资产 (${catalog.length} 个库):`);
    console.log(`| 端口号 (Port) | 数据库名称 (Database) |`);
    console.log(`| :--- | :--- |`);
    for (const item of catalog) {
      console.log(`| **${item.port}** | \`${item.database}\` |`);
    }
    console.log(`\n💡 提示: 查库时可直接使用库名关键词（例如: node scripts/cloud_mysql_query.js ${catalog[0]?.database || 'device'} "SQL"）\n`);
    process.exit(0);
  }

  // 解析目标服务、端口、库名与 SQL
  let port = customPort;
  let database = customDb;
  let sql = null;
  let serviceLabel = '';

  const firstArg = positional[0];
  if (firstArg && SERVICE_DB_MAPPING[firstArg.toLowerCase()]) {
    const mapping = SERVICE_DB_MAPPING[firstArg.toLowerCase()];
    port = port || mapping.port;
    database = database || mapping.database;
    serviceLabel = `${mapping.name} [${firstArg}]`;
    sql = positional[1];
  } else if (firstArg && /^\d+$/.test(firstArg)) {
    port = firstArg;
    database = positional[1];
    sql = positional[2];
    serviceLabel = `端口 ${port}`;
  } else if (firstArg && positional.length >= 2) {
    // 动态模糊匹配数据库资产库名
    const catalog = await loadDbCatalog(token);
    const q = firstArg.toLowerCase();
    const exact = catalog.find(c => c.database.toLowerCase() === q);
    const matches = exact ? [exact] : catalog.filter(c => c.database.toLowerCase().includes(q));

    if (matches.length === 1) {
      port = matches[0].port;
      database = matches[0].database;
      serviceLabel = `智能资产寻址 [${database}]`;
      sql = positional[1];
    } else if (matches.length > 1) {
      console.log(`ℹ️ 关键词 "${firstArg}" 模糊匹配到 ${matches.length} 个库，智能优选: ${matches[0].port} [${matches[0].database}]`);
      port = matches[0].port;
      database = matches[0].database;
      serviceLabel = `智能资产寻址 [${database}]`;
      sql = positional[1];
    } else {
      sql = positional[0];
    }
  } else {
    sql = positional[0];
  }

  if (!port || !database || !sql) {
    console.error(`❌ 参数不完整！必须指定微服务名称 (如 recorder) 或 [端口号 库名]，以及要执行的 SQL！`);
    printUsage();
    process.exit(1);
  }

  const startTime = Date.now();
  if (!outputJson) {
    console.log(`================================================================`);
    console.log(`🚀 服务云 MySQL 自助查询: ${serviceLabel}`);
    console.log(`🌐 实例: 端口 ${port} | 数据库: ${database} | 角色: ${customRole}`);
    console.log(`📝 SQL:  ${sql.replace(/\n+/g, ' ')}`);
    console.log(`================================================================\n`);
  }

  // 1. 发起查询
  const queryUrl = 'https://cloud.intra.ke.com/cloud-proxy-api/xmen/mysql/dql/query';
  const queryRes = await postJson(queryUrl, {
    port: port.toString(),
    database: database,
    role: customRole,
    query: sql
  }, token);

  if (queryRes.isRedirect) {
    console.error(`❌ Token 已失效（服务云已重定向至登录页）！`);
    console.error(`💡 原因：您可能在浏览器中重新扫码登录过，服务云踢出了旧 Session。`);
    printTokenGuide();
    process.exit(1);
  }

  if (!queryRes.success || !queryRes.data) {
    console.error(`❌ 查询请求失败: ${queryRes.error || `HTTP ${queryRes.statusCode}`}`);
    if (queryRes.raw) console.error(`响应内容: ${queryRes.raw.slice(0, 300)}`);
    process.exit(1);
  }

  const resJson = queryRes.data;
  if (resJson.code !== 200000) {
    console.error(`❌ 服务云返回错误 [${resJson.code}]: ${resJson.message}`);
    process.exit(1);
  }

  const queryId = resJson.data.query_id;
  const filePath = resJson.data.file_path;
  const queryResultMeta = resJson.data.query_result || '';

  // 2. 拉取结果 Excel Base64
  const getResultUrl = 'https://cloud.intra.ke.com/cloud-proxy-api/xmen/mysql/dql/get_result';
  const resultRes = await postJson(getResultUrl, {
    query_id: queryId,
    file_path: filePath
  }, token);

  if (!resultRes.success || !resultRes.data || resultRes.data.code !== 200000) {
    console.error(`❌ 获取查询结果失败: ${resultRes.error || (resultRes.data && resultRes.data.message)}`);
    process.exit(1);
  }

  const b64Data = resultRes.data.data;
  const parsedRows = parseXlsxBase64WithPython(b64Data);

  if (parsedRows.error) {
    console.error(`❌ 解析 Excel 数据流失败: ${parsedRows.error}`);
    process.exit(1);
  }

  const costMs = Date.now() - startTime;

  if (outputJson) {
    console.log(JSON.stringify({
      service: firstArg,
      port,
      database,
      role: customRole,
      sql,
      costMs,
      meta: queryResultMeta.trim(),
      headers: parsedRows[0] || [],
      rows: parsedRows.slice(1)
    }, null, 2));
    return;
  }

  console.log(`⏱️ 状态: 成功 | ${queryResultMeta.trim()} | 总耗时: ${costMs}ms\n`);

  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    console.log(`⚠️ 查询结果为空 (0 rows)`);
    return;
  }

  const headers = parsedRows[0] || [];
  const rows = parsedRows.slice(1);

  if (rows.length === 0) {
    console.log(`⚠️ 表头: [${headers.join(', ')}]，但未匹配到数据行 (0 rows)`);
    return;
  }

  // 简单 Markdown 表格输出
  console.log(`| ` + headers.join(' | ') + ` |`);
  console.log(`| ` + headers.map(() => '---').join(' | ') + ` |`);
  for (const r of rows) {
    // 补齐列数
    const padded = headers.map((_, i) => (r[i] !== undefined && r[i] !== null) ? String(r[i]).replace(/\n/g, ' ') : '');
    console.log(`| ` + padded.join(' | ') + ` |`);
  }
  console.log(``);
}

main().catch(err => {
  console.error('执行异常:', err);
  process.exit(1);
});
