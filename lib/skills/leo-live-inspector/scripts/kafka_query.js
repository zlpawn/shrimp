#!/usr/bin/env node

/**
 * 🔍 Leo Live Inspector - Kafka 消息无损只读探查引擎 (Zero-Commit Kafka Inspector)
 * 
 * 核心特性：
 *   1. 绝对零写入：使用临时一次性 GroupId，autoCommit: false，不提交任何位点；
 *   2. 零影响：不影响生产/测试消费组进度，不触发线上 Rebalance；
 *   3. 智能路由：支持 Topic 真实名称、别名与中文模糊词解析，自动匹配 Broker；
 *   4. 精准 Seek：获取最新 High Watermark，直接跳转拉取最新 N 条消息；
 *   5. 高级排障：支持 --offsets-only 积压排查，支持 --grep 关键词/单号过滤。
 */

import { fileURLToPath } from 'node:url';
import { 
  loadKafkaCatalog, 
  resolveTopic, 
  saveTopicToLocal, 
  createKafkaClient, 
  cleanBrokers 
} from './common/kafka.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    topic: null,
    env: 'prod',
    limit: 3,
    partition: null,
    broker: null,
    fromOffset: null,
    offsetsOnly: false,
    grep: null,
    save: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-t' || arg === '--topic') {
      options.topic = args[++i];
    } else if (arg === '-e' || arg === '--env') {
      options.env = args[++i];
    } else if (arg === '-n' || arg === '--limit') {
      options.limit = parseInt(args[++i], 10) || 3;
    } else if (arg === '-p' || arg === '--partition') {
      options.partition = parseInt(args[++i], 10);
    } else if (arg === '-b' || arg === '--broker' || arg === '--brokers') {
      options.broker = args[++i];
    } else if (arg === '--from-offset') {
      options.fromOffset = parseInt(args[++i], 10);
    } else if (arg === '--offsets-only') {
      options.offsetsOnly = true;
    } else if (arg === '-q' || arg === '--grep' || arg === '--filter') {
      options.grep = args[++i];
    } else if (arg === '--save') {
      options.save = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (!options.topic && !arg.startsWith('-')) {
      // 允许首个未具名参数作为 topic
      options.topic = arg;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
🔍 Leo Kafka Inspector - 只读探查命令用法:

  node scripts/kafka_query.js -t <topic|别名|关键词> [选项]

选项:
  -t, --topic <name>          目标 Topic 名称、中文别名或关键词 (必填)
  -e, --env <test|prod>       目标环境: test(测试) 或 prod(线上生产, 默认)
  -n, --limit <count>         拉取最新消息条数 (默认 3)
  -p, --partition <num>       指定只拉取某一个分区 (默认全部分区)
  -b, --broker <hosts>        手动指定 Broker 地址 (覆盖配置)
  --from-offset <num>         从指定的绝对 Offset 开始拉取
  --offsets-only              仅输出各分区的 Low / High 水位与消息总数看板
  -q, --grep <keyword>        按关键词或业务单号在消息内容中筛选
  --save                      将当前查询参数记忆沉淀到 ~/.shrimp 本地持久化配置中
  --json                      以纯 JSON 格式输出消息列表
  -h, --help                  查看帮助

使用示例:
  # 1. 查看线上触达消息最新 3 条 (默认线上)
  node scripts/kafka_query.js -t beijia-reach-event -n 3

  # 2. 用中文模糊词查测试环境工单消息
  node scripts/kafka_query.js -t 工单 -e test -n 2

  # 3. 仅查看各分区位点与消息积压概览
  node scripts/kafka_query.js -t beijia-reach-event --offsets-only

  # 4. 过滤包含指定单号的消息
  node scripts/kafka_query.js -t reach-event -q "T010020260907"
`);
}

async function main() {
  const options = parseArgs();

  if (options.help || !options.topic) {
    printHelp();
    process.exit(options.help ? 0 : 1);
  }

  const isTest = ['test', 'qa', 'dev'].includes(options.env.toLowerCase());
  const envLabel = isTest ? '🟡 测试环境 (TEST)' : '🔴 线上生产 (PROD)';

  // 1. 尝试解析目标 Topic 与 Broker
  let resolved = resolveTopic(options.topic, options.env);
  let targetTopic = resolved ? resolved.targetTopic : options.topic;
  let targetBrokers = options.broker ? cleanBrokers(options.broker) : (resolved ? resolved.broker : []);

  if (targetBrokers.length === 0) {
    console.error(`❌ 未能自动解析到 Topic [${options.topic}] 对应的 Kafka Broker 地址！`);
    console.error(`💡 建议：请手动使用 -b <broker:9092> 指定 Broker 地址（可附加 --save 沉淀到本地）：`);
    console.error(`   node scripts/kafka_query.js -t ${options.topic} -b "kafka118-online.zeus.ljnode.com:9092" --save`);
    process.exit(1);
  }

  // 2. 如果开启了 --save，持久化到本地
  if (options.save) {
    saveTopicToLocal(targetTopic, {
      desc: resolved?.desc || `${targetTopic} (自定义沉淀)`,
      app: resolved?.app || 'custom',
      [isTest ? 'test' : 'prod']: targetBrokers.join(',')
    });
    console.log(`💾 已成功将 Topic [${targetTopic}] 记忆沉淀至 ~/.shrimp/skills/live-inspector/kafka_catalog.json\n`);
  }

  if (!options.json) {
    console.log(`========================================================================`);
    console.log(`🔍 Leo Kafka 只读探查中枢 (Zero-Commit Inspection)`);
    console.log(`========================================================================`);
    console.log(`• 目标主题 (Topic):   ${targetTopic} ${resolved?.desc ? `(${resolved.desc})` : ''}`);
    console.log(`• 当前环境 (Env):     ${envLabel}`);
    console.log(`• 集群地址 (Broker):  ${targetBrokers.join(', ')}`);
    console.log(`• 安全保证:           临时 Group, autoCommit: false, 绝不提交 Offset, 绝不触发 Rebalance`);
    console.log(`========================================================================\n`);
  }

  const kafka = createKafkaClient({
    brokers: targetBrokers,
    clientId: `leo-inspector-${Date.now()}`
  });

  // 3. Admin 探查分区位点 (Watermarks)
  const admin = kafka.admin();
  let partitionOffsets = [];
  try {
    await admin.connect();
    partitionOffsets = await admin.fetchTopicOffsets(targetTopic);
    await admin.disconnect();
  } catch (err) {
    console.error(`❌ 连接 Broker 或读取 Topic [${targetTopic}] 元数据失败:`, err.message);
    try { await admin.disconnect(); } catch {}
    process.exit(1);
  }

  // 4. 处理 --offsets-only 概览模式
  if (options.offsetsOnly) {
    console.log(`📊 分区水位看板 [${targetTopic}]:`);
    console.log(`------------------------------------------------------------------------`);
    console.log(`| 分区 ID   | 最早位点 (Low)     | 最新位点 (High)    | 累计/保留消息量    |`);
    console.log(`------------------------------------------------------------------------`);
    let totalMessages = 0;
    for (const p of partitionOffsets.sort((a, b) => a.partition - b.partition)) {
      const low = parseInt(p.low, 10);
      const high = parseInt(p.high, 10);
      const count = Math.max(0, high - low);
      totalMessages += count;
      console.log(`| P${String(p.partition).padEnd(8)}| ${String(low).padEnd(19)}| ${String(high).padEnd(19)}| ${count.toLocaleString().padEnd(19)}|`);
    }
    console.log(`------------------------------------------------------------------------`);
    console.log(`📈 全部分区总可用消息量: ${totalMessages.toLocaleString()} 条\n`);
    process.exit(0);
  }

  // 5. 确定目标拉取分区与起始 Offset
  let partitionsToRead = partitionOffsets.map(p => p.partition);
  if (options.partition !== null && !isNaN(options.partition)) {
    partitionsToRead = [options.partition];
  }

  // 计算各分区的 targetOffset
  const seekPlan = new Map();
  for (const p of partitionOffsets) {
    if (!partitionsToRead.includes(p.partition)) continue;
    const low = parseInt(p.low, 10);
    const high = parseInt(p.high, 10);
    if (options.fromOffset !== null) {
      seekPlan.set(p.partition, Math.max(low, options.fromOffset));
    } else {
      // 默认最新 N 条
      const target = Math.max(low, high - options.limit);
      seekPlan.set(p.partition, target);
    }
  }

  // 6. 构造临时隔离 Consumer 并拉取
  const consumer = kafka.consumer({
    groupId: `leo-peek-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    sessionTimeout: 8000,
    heartbeatInterval: 2500,
  });

  const collectedMessages = [];
  const maxToCollect = options.grep ? options.limit * 5 : options.limit;

  await consumer.connect();
  await consumer.subscribe({ topic: targetTopic, fromBeginning: false });

  // 关键：加入消费组后针对各分区精准 seek
  consumer.on(consumer.events.GROUP_JOIN, async () => {
    for (const [pId, targetOffset] of seekPlan.entries()) {
      consumer.seek({ topic: targetTopic, partition: pId, offset: String(targetOffset) });
    }
  });

  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch }) => {
      if (partitionsToRead.includes(batch.partition)) {
        for (const message of batch.messages) {
          const rawVal = message.value ? message.value.toString() : '';
          const keyStr = message.key ? message.key.toString() : null;

          // 关键词过滤
          if (options.grep && !rawVal.includes(options.grep) && (!keyStr || !keyStr.includes(options.grep))) {
            continue;
          }

          collectedMessages.push({
            partition: batch.partition,
            offset: message.offset,
            timestamp: parseInt(message.timestamp, 10),
            timeStr: new Date(parseInt(message.timestamp, 10)).toLocaleString(),
            key: keyStr,
            value: rawVal
          });

          if (collectedMessages.length >= options.limit) {
            break;
          }
        }
      }
    }
  });

  // 轮询等待数据收取 (最多等 4.5 秒)
  const startTime = Date.now();
  while (collectedMessages.length < options.limit && Date.now() - startTime < 4500) {
    await new Promise(r => setTimeout(r, 150));
  }

  await consumer.disconnect();

  // 7. 呈现结果
  if (options.json) {
    console.log(JSON.stringify(collectedMessages.slice(0, options.limit), null, 2));
    process.exit(0);
  }

  const finalMessages = collectedMessages.slice(0, options.limit);
  console.log(`✅ 探查完毕，共获取到 ${finalMessages.length} 条消息 (无 Offset 提交，安全退出)：\n`);

  if (finalMessages.length === 0) {
    console.log(`ℹ️ 未在该位点范围内抓取到新消息（目标分区可能为空或暂无符合过滤条件的数据）。`);
  } else {
    for (const [idx, msg] of finalMessages.entries()) {
      console.log(`------------------------------------------------------------------------`);
      console.log(`📩 消息 #${idx + 1} | Partition: [P${msg.partition}] | Offset: [${msg.offset}] | 时间: ${msg.timeStr}`);
      if (msg.key) console.log(`🔑 Key: ${msg.key}`);
      
      try {
        const parsed = JSON.parse(msg.value);
        console.log(`📦 Payload (JSON):`);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(`📦 Payload (Raw 文本):`);
        console.log(msg.value);
      }
      console.log();
    }
  }
}

main().catch(err => {
  console.error('❌ 执行探查出现异常:', err.message);
  process.exit(1);
});
