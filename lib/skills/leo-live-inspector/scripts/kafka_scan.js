#!/usr/bin/env node

/**
 * 📡 Leo Live Inspector - 跨工程 Kafka 资产批量自动扫描与沉淀引擎 (Kafka Asset Scanner)
 * 
 * 功能：
 *   1. 扫描指定的一个或多个目录（支持微服务子工程遍历与深层扫描）；
 *   2. 自动定位 application*.yml、application*.properties、bootstrap*.yml；
 *   3. 智能解析 kafka-broker/kafka-topic、spring.kafka.bootstrap-servers 以及业务自定义 topic 配置；
 *   4. 生成以 Topic 为一等公民的标准化扁平结构；
 *   5. 支持直接导出至 resources/default_kafka.json 或本地 ~/.shrimp 目录。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 默认 4 大常用项目根目录
const DEFAULT_ROOT_DIRS = [
  '/Users/pa/project/IOT',
  '/Users/pa/project/HT',
  '/Users/pa/project/ZK',
  '/Users/pa/project/JZ'
];

const DEFAULT_EXCLUDES = ['iot-black-pearl', 'node_modules', '.git', 'target', 'build', '.idea'];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dirs: DEFAULT_ROOT_DIRS,
    excludes: [...DEFAULT_EXCLUDES],
    exportFile: null,
    verbose: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-d' || arg === '--dirs' || arg === '--dir') {
      const val = args[++i];
      if (val) options.dirs = val.split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--exclude' || arg === '-x') {
      const val = args[++i];
      if (val) options.excludes.push(...val.split(',').map(s => s.trim()));
    } else if (arg === '-o' || arg === '--export' || arg === '--output') {
      options.exportFile = args[++i];
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    }
  }

  return options;
}

/**
 * 递归查找所有 application/bootstrap 配置文件
 */
function findConfigFiles(dir, excludes, maxDepth = 10, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];
  const results = [];

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (excludes.some(ex => entry.name === ex || fullPath.includes(`/${ex}/`) || fullPath.endsWith(`/${ex}`))) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...findConfigFiles(fullPath, excludes, maxDepth, currentDepth + 1));
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if ((lower.startsWith('application') || lower.startsWith('bootstrap')) &&
          (lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.properties'))) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

/**
 * 极轻量级提取 yml/properties 中的 key-value，避免外部 yaml 解析库在复杂 Spring YML 中报错
 */
function extractKafkaPairsFromContent(content, filePath) {
  const lines = content.split('\n');
  const brokers = {};
  const topics = {};
  let currentEnv = 'default';

  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('-test') || lowerPath.includes('test.')) currentEnv = 'test';
  else if (lowerPath.includes('-prod') || lowerPath.includes('prod.') || lowerPath.includes('online')) currentEnv = 'prod';
  else if (lowerPath.includes('-dev') || lowerPath.includes('dev.')) currentEnv = 'dev';
  else if (lowerPath.includes('-preview') || lowerPath.includes('preview.')) currentEnv = 'preview';

  let currentSection = null; // 'broker' | 'topic'

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // 1. Section 侦测
    if (/^kafka-broker\s*:/.test(line)) {
      currentSection = 'kafka-broker';
      continue;
    }
    if (/^kafka-topic\s*:/.test(line)) {
      currentSection = 'kafka-topic';
      continue;
    }
    if (/^[a-zA-Z0-9_\-\.]+\s*:/.test(line) && !line.startsWith(' ') && !line.startsWith('\t')) {
      if (!line.startsWith('kafka-')) {
        currentSection = null;
      }
    }

    // 2. Section 内部解析 (kafka-broker / kafka-topic)
    if (currentSection === 'kafka-broker') {
      const match = line.match(/^([a-zA-Z0-9_\-]+)\s*:\s*(.+)$/);
      if (match) {
        const key = match[1];
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (val.includes(':9092') || val.includes(':3001') || val.includes(':3002') || val.includes(':3003')) {
          brokers[key] = { env: currentEnv, val };
        }
      }
    } else if (currentSection === 'kafka-topic') {
      const match = line.match(/^([a-zA-Z0-9_\-]+)\s*:\s*(.+)$/);
      if (match) {
        const key = match[1];
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (val && !val.includes('{') && !val.includes(':')) {
          topics[key] = { env: currentEnv, val };
        }
      }
    }

    // 3. 通用 Spring Kafka bootstrap-servers 探测
    const bootstrapMatch = line.match(/bootstrap-servers\s*:\s*(.+)$/i);
    if (bootstrapMatch) {
      const val = bootstrapMatch[1].trim().replace(/^["']|["']$/g, '');
      if (val.includes(':9092') || val.includes(':3001')) {
        brokers['default'] = { env: currentEnv, val };
      }
    }

    // 4. 通用 key 包含 topic 的探测 (如 kafka.scs-tenant-1.epx.topic: xxx 或 topic: xxx)
    const topicMatch = line.match(/([a-zA-Z0-9_\-\.]*topic[a-zA-Z0-9_\-\.]*)\s*:\s*(.+)$/i);
    if (topicMatch) {
      const key = topicMatch[1];
      const val = topicMatch[2].trim().replace(/^["']|["']$/g, '');
      if (val && !['true', 'false', 'null'].includes(val.toLowerCase()) && !val.includes(' ') && !val.includes('${') && !val.startsWith('/') && val.length > 3 && !val.endsWith('.yml')) {
        topics[key] = { env: currentEnv, val };
      }
    }
  }

  return { brokers, topics, currentEnv };
}

/**
 * 核心扫描执行器
 */
export async function runScan(options) {
  console.log('🔍 开始全量扫描 Kafka 资产...');
  console.log(`📂 扫描目标根目录: \n  - ${options.dirs.join('\n  - ')}`);
  console.log(`🚫 排除项: ${options.excludes.join(', ')}\n`);

  const allConfigFiles = [];
  for (const rootDir of options.dirs) {
    if (!fs.existsSync(rootDir)) {
      console.warn(`⚠️ 目录不存在，跳过: ${rootDir}`);
      continue;
    }
    const found = findConfigFiles(rootDir, options.excludes);
    allConfigFiles.push(...found);
  }

  console.log(`📄 共发现 ${allConfigFiles.length} 个 Spring Boot 配置文件，正在分析 Kafka 节点与主题...`);

  // 聚合各项目的提取结果
  const appMap = {};

  for (const filePath of allConfigFiles) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    // 寻找最近的 project 目录名
    const relParts = filePath.split('/');
    let projectName = 'unknown';
    for (let i = relParts.length - 2; i >= 0; i--) {
      if (relParts[i] === 'resources' && relParts[i - 1] === 'main' && relParts[i - 2] === 'src') {
        projectName = relParts[i - 4] || relParts[i - 3];
        break;
      }
    }

    const { brokers, topics, currentEnv } = extractKafkaPairsFromContent(content, filePath);

    if (Object.keys(brokers).length > 0 || Object.keys(topics).length > 0) {
      if (!appMap[projectName]) {
        appMap[projectName] = { testBrokers: {}, prodBrokers: {}, topics: {} };
      }

      for (const [bKey, bObj] of Object.entries(brokers)) {
        if (bObj.env === 'test' || bObj.env === 'dev') {
          appMap[projectName].testBrokers[bKey] = bObj.val;
        } else if (bObj.env === 'prod' || bObj.env === 'preview' || bObj.env === 'default') {
          appMap[projectName].prodBrokers[bKey] = bObj.val;
        }
      }

      for (const [tKey, tObj] of Object.entries(topics)) {
        if (!appMap[projectName].topics[tKey]) {
          appMap[projectName].topics[tKey] = {};
        }
        if (tObj.env === 'test' || tObj.env === 'dev') {
          appMap[projectName].topics[tKey].test = tObj.val;
        } else {
          appMap[projectName].topics[tKey].prod = tObj.val;
        }
      }
    }
  }

  // 转换为以 Topic 为一等公民的最终扁平目录
  const catalog = {};

  for (const [projectName, data] of Object.entries(appMap)) {
    const defaultTestBroker = data.testBrokers['default'] || Object.values(data.testBrokers)[0] || '';
    const defaultProdBroker = data.prodBrokers['default'] || Object.values(data.prodBrokers)[0] || '';

    for (const [topicKey, tItem] of Object.entries(data.topics)) {
      const prodName = tItem.prod || tItem.test;
      const testName = tItem.test || tItem.prod;
      if (!prodName && !testName) continue;

      // 决定主 Key（以线上名称优先，避免前缀污染）
      const primaryKey = prodName || testName;
      if (!primaryKey || ['true', 'false', 'null'].includes(primaryKey.toLowerCase()) || primaryKey.length < 3) continue;

      // 查找该 topic 关联的 broker (如果 key 与 brokerKey 对应)
      const matchedTestBroker = data.testBrokers[topicKey] || defaultTestBroker;
      const matchedProdBroker = data.prodBrokers[topicKey] || defaultProdBroker;

      if (!catalog[primaryKey]) {
        catalog[primaryKey] = {
          desc: `${projectName} 业务事件 (${topicKey})`,
          app: projectName,
        };

        if (testName !== primaryKey && testName) {
          catalog[primaryKey].test = {
            broker: matchedTestBroker,
            topic: testName
          };
        } else if (matchedTestBroker) {
          catalog[primaryKey].test = matchedTestBroker;
        }

        if (matchedProdBroker) {
          catalog[primaryKey].prod = matchedProdBroker;
        }
      }
    }
  }

  const topicCount = Object.keys(catalog).length;
  console.log(`✨ 扫描完成！共提取并格式化了 ${topicCount} 个 Kafka 业务主题！\n`);

  // 打印样例
  const sampleKeys = Object.keys(catalog).slice(0, 8);
  console.log('📌 样例 Topic 资产预览:');
  for (const sk of sampleKeys) {
    console.log(`  - [${sk}]:`);
    console.log(`    App: ${catalog[sk].app}`);
    console.log(`    Test: ${JSON.stringify(catalog[sk].test)}`);
    console.log(`    Prod: ${JSON.stringify(catalog[sk].prod)}`);
  }

  if (options.exportFile) {
    const targetPath = path.isAbsolute(options.exportFile) 
      ? options.exportFile 
      : path.join(__dirname, '..', options.exportFile);

    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(targetPath, JSON.stringify(catalog, null, 2), 'utf8');
    console.log(`\n💾 资产已成功保存导出至: ${targetPath}`);
  }

  return catalog;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs();
  if (options.help) {
    console.log(`
用法:
  node scripts/kafka_scan.js [选项]

选项:
  -d, --dirs <dir1,dir2>      扫描的根目录 (默认 4 大常用目录)
  -x, --exclude <name>        排除的目录 (默认排除 iot-black-pearl 等)
  -o, --export <path>         导出输出 JSON 文件路径
  -v, --verbose               详细日志输出
  -h, --help                  查看帮助
    `);
    process.exit(0);
  }

  runScan(options).catch(err => {
    console.error('❌ 扫描失败:', err);
    process.exit(1);
  });
}
