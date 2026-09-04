#!/usr/bin/env node

/**
 * 🗄️ Leo Live Inspector - 线下与测试环境 MySQL 直连查询与写入引擎 (Test MySQL Direct Query & Write Engine)
 * 
 * 核心特性：
 *   1. 独立自包含：基于 mysql2/promise 毫秒级直连内网测试库，零外部 Skill/MCP 依赖；
 *   2. 单服务多数据源 (Multi-Datasource)：支持单服务挂载多库、租户分库，通过 --ds 自由切换；
 *   3. 本地工程配置嗅探：支持从当前目录 (CWD) 的 application-test.yml / .env.test 自动提取数据源与密码；
 *   4. 智能目录引导：若缺少密码，主动引导用户前往对应项目根路径运行，零手动配参；
 *   5. 验通即静默持久化：握手测试成功后自动将密码与连接沉淀至 ~/.shrimp/skills/live-inspector/test_databases.json；
 *   6. 美化终端展示：结构化 Markdown 表格回显、执行耗时与行数统计，支持 --json 输出；
 *   7. DML/DDL 写入支持：INSERT/UPDATE/DELETE/REPLACE/CREATE/ALTER/DROP/TRUNCATE，含无 WHERE 保护。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyzeSql, looksLikeSql } from './common/sql-analysis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _mysql = null;
async function getMysql() {
  if (_mysql) return _mysql;
  if (process.env.LEO_TEST_MYSQL_MODULE) {
    const mod = await import(process.env.LEO_TEST_MYSQL_MODULE);
    _mysql = mod.default || mod;
    return _mysql;
  }
  const candidates = [
    'mysql2/promise',
    path.join(__dirname, '..', 'node_modules', 'mysql2', 'promise.js'),
    path.join(process.cwd(), 'node_modules', 'mysql2', 'promise.js'),
    path.join(os.homedir(), 'project', 'AI', 'local-ai-gateway', 'node_modules', 'mysql2', 'promise.js'),
    path.join(os.homedir(), '.agents', 'node_modules', 'mysql2', 'promise.js')
  ];
  for (const c of candidates) {
    try {
      const mod = await import(c);
      _mysql = mod.default || mod;
      return _mysql;
    } catch {}
  }
  throw new Error('未找到 mysql2/promise 模块，请先执行 npm install mysql2。');
}

const SHRIMP_DIR = path.join(os.homedir(), '.shrimp', 'skills', 'live-inspector');
const USER_TEST_DB_FILE = path.join(SHRIMP_DIR, 'test_databases.json');
const BUILTIN_TEST_DB_FILE = path.join(__dirname, '..', 'resources', 'default_test_databases.json');

// 常用微服务别名映射
const ALIAS_MAP = {
  'saas': 'utopia-scs-saas',
  'scs': 'utopia-scs-saas',
  'utopia-scs-saas': 'utopia-scs-saas',
  'recorder': 'utopia-scs-recorder',
  'utopia-scs-recorder': 'utopia-scs-recorder',
  'algo': 'utopia-scs-algo',
  'utopia-scs-algo': 'utopia-scs-algo',
  'viper': 'utopia-viper',
  'utopia-viper': 'utopia-viper',
  'black-pearl': 'iot-black-pearl',
  'iot-black-pearl': 'iot-black-pearl',
  'platform': 'iot-platform',
  'iot': 'iot-platform',
  'iot-platform': 'iot-platform',
  'zulin-iot-platform': 'iot-platform',
  'ecology': 'iot-ecology-platform',
  'iot-ecology-platform': 'iot-ecology-platform',
  'warehouse': 'beijia-iot-warehouse',
  'beijia-iot-warehouse': 'beijia-iot-warehouse',
  'erp-core': 'iot-erp-core',
  'iot-erp-core': 'iot-erp-core',
  'erp-finance': 'iot-erp-finance',
  'iot-erp-finance': 'iot-erp-finance',
  'cloud-plat': 'huiju-iot-cloud-plat',
  'huiju-iot-cloud-plat': 'huiju-iot-cloud-plat',
  'adaptor': 'iot-device-adaptor',
  'iot-device-adaptor': 'iot-device-adaptor',
  'chatbot': 'rent-ai-chat',
  'rent-ai-chat': 'rent-ai-chat',
  'cangjie': 'cangjie',
  'data-hub': 'cangjie-data-hub',
  'cangjie-data-hub': 'cangjie-data-hub',
  'memory': 'dial-insight-memory',
  'dial-insight-memory': 'dial-insight-memory',
  'power-core': 'iot-power-core',
  'iot-power-core': 'iot-power-core'
};

// 常见项目源码根目录推荐路径（用于引导用户）
const PROJECT_DIR_HINTS = {
  'utopia-scs-saas': '/Users/pa/project/JZ/utopia-scs-saas',
  'utopia-scs-recorder': '/Users/pa/project/JZ/utopia-scs-recorder',
  'utopia-scs-algo': '/Users/pa/project/JZ/utopia-scs-algo',
  'utopia-viper': '/Users/pa/project/JZ/utopia-viper',
  'iot-black-pearl': '/Users/pa/project/JZ/iot-black-pearl',
  'iot-platform': '/Users/pa/project/IOT/LOCK/iot-platform',
  'iot-ecology-platform': '/Users/pa/project/IOT/ECO/iot-ecology-platform',
  'beijia-iot-warehouse': '/Users/pa/project/IOT/ERP/beijia-iot-warehouse',
  'iot-erp-core': '/Users/pa/project/IOT/ERP/iot-erp-core',
  'iot-erp-finance': '/Users/pa/project/IOT/ERP/iot-erp-finance',
  'huiju-iot-cloud-plat': '/Users/pa/project/IOT/LOCK/huiju-iot-cloud-plat',
  'iot-device-adaptor': '/Users/pa/project/IOT/LOCK/iot-device-adaptor',
  'rent-ai-chat': '/Users/pa/project/IOT/KF/rent-ai-chat',
  'cangjie': '/Users/pa/project/HT/cangjie',
  'cangjie-data-hub': '/Users/pa/project/HT/cangjie-data-hub',
  'dial-insight-memory': '/Users/pa/project/HT/dial-insight-memory',
  'iot-power-core': '/Users/pa/project/ZK/iot-power-core'
};

function loadDatabaseConfigs() {
  const merged = {};

  // 1. 读取内置拓扑元数据
  if (fs.existsSync(BUILTIN_TEST_DB_FILE)) {
    try {
      const builtin = JSON.parse(fs.readFileSync(BUILTIN_TEST_DB_FILE, 'utf8'));
      Object.assign(merged, builtin);
    } catch (e) {}
  }

  // 2. 读取用户本地已沉淀的凭证缓存 (~/.shrimp) 并深度覆盖
  if (fs.existsSync(USER_TEST_DB_FILE)) {
    try {
      const userCache = JSON.parse(fs.readFileSync(USER_TEST_DB_FILE, 'utf8'));
      for (const [svcName, svcData] of Object.entries(userCache)) {
        if (!merged[svcName]) {
          merged[svcName] = svcData;
        } else {
          merged[svcName].defaultDatasource = svcData.defaultDatasource || merged[svcName].defaultDatasource;
          merged[svcName].datasources = Object.assign({}, merged[svcName].datasources, svcData.datasources);
        }
      }
    } catch (e) {}
  }

  return merged;
}

function saveUserDatabaseConfig(svcName, dsAlias, dsConfig) {
  try {
    if (!fs.existsSync(SHRIMP_DIR)) {
      fs.mkdirSync(SHRIMP_DIR, { recursive: true });
    }
    let userCache = {};
    if (fs.existsSync(USER_TEST_DB_FILE)) {
      try {
        userCache = JSON.parse(fs.readFileSync(USER_TEST_DB_FILE, 'utf8'));
      } catch {}
    }

    if (!userCache[svcName]) {
      userCache[svcName] = {
        serviceName: svcName,
        defaultDatasource: dsAlias,
        datasources: {}
      };
    }
    userCache[svcName].datasources[dsAlias] = Object.assign({}, userCache[svcName].datasources[dsAlias], dsConfig);
    fs.writeFileSync(USER_TEST_DB_FILE, JSON.stringify(userCache, null, 2), 'utf8');
  } catch (err) {
    // 静默降级，不阻断查询
  }
}

/**
 * 从当前工作目录 (CWD) 动态嗅探测试数据源配置
 */
function sniffLocalWorkspaceConfigs(cwd = process.cwd()) {
  const discovered = [];

  function scanDir(dir, depth = 0) {
    if (depth > 4) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'target') continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          scanDir(full, depth + 1);
        } else if (ent.isFile()) {
          if (ent.name === '.env.test' || ent.name === '.env') {
            parseEnvFile(full);
          } else if (/^application(-[a-zA-Z0-9_-]+)?\.(ya?ml|properties)$/.test(ent.name)) {
            parseConfigFile(full);
          }
        }
      }
    } catch {}
  }

  function parseEnvFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const vars = {};
      for (const line of lines) {
        const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      if (vars.MYSQL_HOST && vars.MYSQL_DB) {
        discovered.push({
          host: vars.MYSQL_HOST,
          port: parseInt(vars.MYSQL_PORT || '3306', 10),
          database: vars.MYSQL_DB,
          user: vars.MYSQL_USER || 'root',
          password: vars.MYSQL_PASSWORD || '',
          alias: vars.MYSQL_DB,
          sourceFile: filePath
        });
      }
    } catch {}
  }

  function parseConfigFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('jdbc:mysql:') || line.includes('mysql://')) {
          const match = line.match(/(jdbc:mysql:\/\/|mysql:\/\/)([^:\/]+):(\d+)\/([^?#\s"']+)/);
          if (match) {
            const host = match[2];
            const port = parseInt(match[3], 10);
            const database = match[4];

            let user = 'root';
            let password = '';
            let alias = database;

            const win = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 10));
            for (const wl of win) {
              const uMatch = wl.match(/^\s*(?:username|dbUser|user)\s*:\s*["']?([^"'\s#]+)["']?/);
              if (uMatch) user = uMatch[1];
              const pMatch = wl.match(/^\s*(?:password|dbPassword)\s*:\s*["']?([^"'\s#]+)["']?/);
              if (pMatch && !pMatch[1].includes('$')) password = pMatch[1];
            }

            discovered.push({
              host,
              port,
              database,
              user,
              password,
              alias,
              sourceFile: filePath
            });
          }
        }
      }
    } catch {}
  }

  scanDir(cwd);
  return discovered;
}

function printUsage() {
  console.log(`
🔍 Leo Test MySQL Direct Query & Write Engine (线下/测试环境 MySQL 直连查询与写入引擎)

用法:
  node scripts/test_mysql_query.js <service|host> [datasource|sql] [sql] [options]

参数说明:
  <service|host>    微服务别名 (如 saas, recorder, iot, cangjie) 或 数据库主机/端口
  [datasource]      指定数据源别名 (当项目有多个数据源时，如 tenant0, base, cp1)
  [sql]             待执行的 SQL 语句

支持的 SQL 类型:
  查询 (SELECT)     SELECT / SHOW / DESC / EXPLAIN
  写入 (DML)        INSERT / UPDATE / DELETE / REPLACE
  结构 (DDL)        CREATE TABLE / ALTER TABLE / DROP TABLE / TRUNCATE

常用选项:
  --ds <alias>           显式指定数据源别名
  --list-ds              列出该微服务下所有已配置的测试数据源
  --force                强制执行无 WHERE 条件的 UPDATE/DELETE (默认拦截)
  -p, --password <pwd>   临时指定/补充数据库密码 (验通后将自动静默存入 ~/.shrimp)
  -u, --user <user>      覆盖连接用户名 (默认 root)
  --host <host>          覆盖连接主机
  --port <port>          覆盖连接端口
  -d, --database <db>    覆盖目标数据库名
  --max-rows <num>       最大返回行数限制 (默认 50)
  --json                 输出格式化 JSON 数据
  -h, --help             显示帮助信息

示例:
  # 查 SaaS 服务测试主库
  node scripts/test_mysql_query.js saas "SELECT * FROM algo_detect_report ORDER BY id DESC LIMIT 5"

  # 查 SaaS 指定的租户分库 (tenant1)
  node scripts/test_mysql_query.js saas tenant1 "SELECT * FROM t_user_order LIMIT 5"

  # 插入一条记录
  node scripts/test_mysql_query.js saas "INSERT INTO t_config (key_name, value) VALUES ('test_key', 'test_val')"

  # 更新指定记录
  node scripts/test_mysql_query.js saas "UPDATE t_config SET value = 'new_val' WHERE key_name = 'test_key'"

  # 删除指定记录
  node scripts/test_mysql_query.js saas "DELETE FROM t_config WHERE key_name = 'test_key'"

  # 建表
  node scripts/test_mysql_query.js saas "CREATE TABLE t_test_tmp (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(64))"

  # 强制全表更新 (需 --force)
  node scripts/test_mysql_query.js saas --force "UPDATE t_config SET status = 0"

  # 列出仓颉系统所有测试数据源
  node scripts/test_mysql_query.js cangjie --list-ds

安全规则:
  • 无 WHERE 条件的 UPDATE/DELETE 默认拦截，需显式传入 --force 跳过保护
  • 仅限测试/线下环境内网数据库，不可直连生产
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  // 解析 Flags
  let serviceArg = '';
  let positional = [];
  let dsArg = '';
  let customHost = '';
  let customPort = 0;
  let customUser = '';
  let customPassword = '';
  let customDatabase = '';
  let maxRows = 50;
  let outputJson = false;
  let listDsOnly = false;
  let forceMode = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--ds' && i + 1 < args.length) {
      dsArg = args[++i];
    } else if (a === '--list-ds') {
      listDsOnly = true;
    } else if ((a === '-p' || a === '--password') && i + 1 < args.length) {
      customPassword = args[++i];
    } else if ((a === '-u' || a === '--user') && i + 1 < args.length) {
      customUser = args[++i];
    } else if (a === '--host' && i + 1 < args.length) {
      customHost = args[++i];
    } else if (a === '--port' && i + 1 < args.length) {
      customPort = parseInt(args[++i], 10);
    } else if ((a === '-d' || a === '--database') && i + 1 < args.length) {
      customDatabase = args[++i];
    } else if (a === '--max-rows' && i + 1 < args.length) {
      maxRows = parseInt(args[++i], 10) || 50;
    } else if (a === '--json') {
      outputJson = true;
    } else if (a === '--force') {
      forceMode = true;
    } else if (!a.startsWith('-')) {
      if (!serviceArg) serviceArg = a;
      else positional.push(a);
    }
  }

  const allConfigs = loadDatabaseConfigs();
  const canonicalService = ALIAS_MAP[serviceArg.toLowerCase()] || serviceArg;
  let serviceConfig = allConfigs[canonicalService] || allConfigs[serviceArg];

  // 1. 如果只需要列出数据源
  if (listDsOnly) {
    if (!serviceConfig || !serviceConfig.datasources) {
      console.log(`⚠️ 未找到服务【${serviceArg}】已注册的测试数据源。`);
      process.exit(1);
    }
    console.log(`\n📦 微服务【${canonicalService}】的可用测试数据源列表：`);
    console.log(`⭐ 默认主数据源: ${serviceConfig.defaultDatasource || Object.keys(serviceConfig.datasources)[0]}\n`);
    for (const [alias, ds] of Object.entries(serviceConfig.datasources)) {
      const isDef = (alias === serviceConfig.defaultDatasource) ? ' (默认)' : '';
      console.log(`  ├─ [${alias}]${isDef} ➔ ${ds.host}:${ds.port}/${ds.database} (用户: ${ds.user})`);
    }
    console.log(``);
    process.exit(0);
  }

  // 2. 解析数据源与 SQL
  let targetDatasource = null;
  let sql = '';

  if (positional.length === 1) {
    sql = positional[0];
  } else if (positional.length >= 2) {
    // 判断第 1 个位置参数是数据源还是 SQL
    if (looksLikeSql(positional[0])) {
      sql = positional[0];
    } else {
      dsArg = positional[0];
      sql = positional[1];
    }
  }

  const analysis = analyzeSql(sql);

  // 3. 安全拦截: UPDATE/DELETE 仅允许明确识别到顶层 WHERE，除非显式 --force
  if (!forceMode && analysis.guardRequired && analysis.hasTopLevelWhere !== true) {
    console.error(`\n🛑 安全拦截: 检测到缺少明确顶层 WHERE 条件的 ${analysis.keyword} 操作！`);
    console.error(`   这可能影响整张表的所有数据行，已在连接数据库前自动阻断。\n`);
    console.error(`💡 如果确认需要全表操作，请添加 --force 标志：`);
    console.error(`   node scripts/test_mysql_query.js ${serviceArg} --force "${sql}"\n`);
    process.exit(1);
  }

  // 4. 提取具体数据源配置
  if (serviceConfig && serviceConfig.datasources) {
    const dss = serviceConfig.datasources;
    if (dsArg && dss[dsArg]) {
      targetDatasource = dss[dsArg];
    } else if (dsArg) {
      // 模糊匹配
      const found = Object.entries(dss).find(([k, v]) => k.toLowerCase() === dsArg.toLowerCase() || v.database.toLowerCase() === dsArg.toLowerCase());
      if (found) targetDatasource = found[1];
    }

    if (!targetDatasource) {
      const defKey = serviceConfig.defaultDatasource || Object.keys(dss)[0];
      targetDatasource = dss[defKey];
      if (Object.keys(dss).length > 1 && !outputJson) {
        console.log(`ℹ️ 服务【${canonicalService}】配置了 ${Object.keys(dss).length} 个数据源，自动优选默认数据源 [${targetDatasource.alias}]（可通过 --ds <alias> 指定其他库）`);
      }
    }
  }

  // 5. 支持离散参数直接覆盖或完全自组装
  let host = customHost || targetDatasource?.host;
  let port = customPort || targetDatasource?.port || 3306;
  let user = customUser || targetDatasource?.user || 'root';
  let password = customPassword || targetDatasource?.password || '';
  let database = customDatabase || targetDatasource?.database || '';
  const dsAlias = dsArg || targetDatasource?.alias || database || 'default';

  // 6. 如果缺少密码，尝试从当前工作目录 (CWD) 动态嗅探
  if (!password) {
    const sniffed = sniffLocalWorkspaceConfigs(process.cwd());
    if (sniffed.length > 0) {
      // 优先匹配相同 database 或 host
      const match = sniffed.find(s => s.database === database || s.port === port) || sniffed[0];
      if (match && match.password) {
        password = match.password;
        if (!host) host = match.host;
        if (!port) port = match.port;
        if (!database) database = match.database;
        if (!outputJson) {
          console.log(`🔍 从当前工程本地配置文件中成功嗅探到数据源凭证 (${path.basename(match.sourceFile)})`);
        }
      }
    }
  }

  // 7. 如果依然没有密码，给出精准的目录引导与错误提示
  if (!password) {
    const suggestedDir = PROJECT_DIR_HINTS[canonicalService] || `~/project/.../${canonicalService}`;
    console.error(`\n❌ 未找到微服务【${canonicalService}】测试数据库的连接密码！\n`);
    console.error(`💡 智能指引（推荐）：`);
    console.error(`   请切换到该项目的代码根目录下执行本命令：`);
    console.error(`   👉 cd ${suggestedDir}`);
    console.error(`   系统将自动就地从 application-test.yml / .env.test 提取密码并建立连接。\n`);
    console.error(`🛠️ 备选方式：直接通过参数提供一次密码：`);
    console.error(`   node scripts/test_mysql_query.js ${serviceArg} -p <你的测试库密码> "${sql || 'SELECT 1'}"`);
    console.error(`   （一旦握手连通，系统将自动为您静默保存到 ~/.shrimp，下次在此目录即可秒级免密复用）\n`);
    process.exit(1);
  }

  if (!host || !database || !sql) {
    console.error(`❌ 参数不完整！必须指定服务名/主机、目标数据库及要执行的 SQL！`);
    printUsage();
    process.exit(1);
  }

  // 8. 使用 SQL 分析结果决定操作分类与展示
  const isDML = analysis.category === 'DML';
  const isDDL = analysis.category === 'DDL';
  const isWrite = analysis.isWrite;

  const startTime = Date.now();
  const opLabel = isDDL ? '结构变更' : (isDML ? '数据写入' : '数据查询');
  if (!outputJson) {
    console.log(`================================================================`);
    console.log(`🚀 Leo 测试环境 MySQL 直连${opLabel}: ${canonicalService} [${dsAlias}]`);
    console.log(`🌐 节点: ${host}:${port} | 库: ${database} | 用户: ${user}`);
    console.log(`📝 SQL:  ${sql.replace(/\n+/g, ' ')}`);
    if (isWrite) console.log(`⚡ 操作类型: ${isDDL ? 'DDL (结构变更)' : 'DML (数据写入)'}`);
    console.log(`================================================================\n`);
  }

  let connection = null;
  try {
    const mysql = await getMysql();
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      connectTimeout: 4000
    });

    // 握手验证通过 -> 自动静默持久化沉淀到 ~/.shrimp
    saveUserDatabaseConfig(canonicalService, dsAlias, {
      alias: dsAlias,
      database,
      host,
      port,
      user,
      password
    });

    // 执行 SQL
    const [rows, fields] = await connection.query(sql);
    const costMs = Date.now() - startTime;

    // -- JSON 输出模式 --
    if (outputJson) {
      const result = {
        service: canonicalService,
        datasource: dsAlias,
        host,
        port,
        database,
        sql,
        costMs,
        operationType: isDDL ? 'DDL' : (isDML ? 'DML' : 'QUERY')
      };
      if (isWrite && rows && typeof rows.affectedRows === 'number') {
        result.affectedRows = rows.affectedRows;
        result.insertId = rows.insertId || 0;
        result.changedRows = rows.changedRows || 0;
        result.warningStatus = rows.warningStatus || 0;
      } else {
        result.total = Array.isArray(rows) ? rows.length : 0;
        result.rows = Array.isArray(rows) ? rows.slice(0, maxRows) : rows;
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // -- DML/DDL 写入结果输出 --
    if (isWrite && rows && typeof rows.affectedRows === 'number') {
      console.log(`✅ ${opLabel}执行成功 | 总耗时: ${costMs}ms\n`);
      console.log(`| 指标 | 值 |`);
      console.log(`| --- | --- |`);
      console.log(`| 影响行数 (affectedRows) | ${rows.affectedRows} |`);
      if (isDML && analysis.keyword === 'INSERT') {
        console.log(`| 自增ID (insertId) | ${rows.insertId || 0} |`);
      }
      if (isDML && (analysis.keyword === 'UPDATE' || analysis.keyword === 'REPLACE')) {
        console.log(`| 实际变更行 (changedRows) | ${rows.changedRows || 0} |`);
      }
      if (rows.warningStatus > 0) {
        console.log(`| ⚠️ 警告数 (warnings) | ${rows.warningStatus} |`);
      }
      console.log(``);
      if (isDDL && analysis.tableName) {
        console.log(`✅ ${analysis.keyword} 表 ${analysis.tableName} 执行成功。\n`);
      }
      return;
    }

    // -- SELECT / SHOW 查询结果输出 --
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`⏱️ 执行耗时: ${costMs}ms | 匹配结果: 0 rows`);
      console.log(`⚠️ 查询结果为空。`);
      return;
    }

    const headers = fields ? fields.map(f => f.name) : Object.keys(rows[0]);
    const displayRows = rows.slice(0, maxRows);

    console.log(`⏱️ 状态: 查询成功 | 返回: ${rows.length} rows (展示前 ${displayRows.length} 条) | 总耗时: ${costMs}ms\n`);

    // 打印标准 Markdown 表格
    console.log(`| ` + headers.join(' | ') + ` |`);
    console.log(`| ` + headers.map(() => '---').join(' | ') + ` |`);
    for (const r of displayRows) {
      const line = headers.map(h => {
        const val = r[h];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val).replace(/\n/g, ' ');
      });
      console.log(`| ` + line.join(' | ') + ` |`);
    }
    console.log(``);

  } catch (err) {
    console.error(`\n❌ SQL 执行失败: ${err.message}`);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error(`💡 账号或密码错误，请核实测试环境密码。`);
    } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      console.error(`💡 网络连通超时，请检查内网环境或目标端口 ${port} 是否放行。`);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end().catch(() => {});
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
