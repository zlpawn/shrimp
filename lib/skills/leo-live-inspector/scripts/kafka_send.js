#!/usr/bin/env node

/**
 * 🚀 Leo Live Inspector - Kafka 消息安全模拟投递引擎 (Safe Kafka Event Producer)
 * 
 * 核心特性：
 *   1. 风控第一：默认环境为 test(测试环境)，严禁误触生产；向 prod 发送必须显式附加 --force-danger-confirm；
 *   2. 智能模板：支持利用 Topic 预存的 sample 模板，自动替换指定业务字段并刷新时间戳；
 *   3. 零配置解析：支持中文别名与模糊词自动解析对应的测试环境 Topic 与 Broker；
 *   4. 投递追踪：投递成功后回显 Partition、Offset 及投递耗时。
 */

import { fileURLToPath } from 'node:url';
import { 
  resolveTopic, 
  saveTopicToLocal, 
  createKafkaClient, 
  cleanBrokers 
} from './common/kafka.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    topic: null,
    env: 'test', // 默认测试环境！安全优先
    data: null,
    key: null,
    partition: null,
    broker: null,
    useSample: false,
    setFields: {},
    forceDangerConfirm: false,
    save: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-t' || arg === '--topic') {
      options.topic = args[++i];
    } else if (arg === '-e' || arg === '--env') {
      options.env = args[++i];
    } else if (arg === '-d' || arg === '--data' || arg === '--payload') {
      options.data = args[++i];
    } else if (arg === '-k' || arg === '--key') {
      options.key = args[++i];
    } else if (arg === '-p' || arg === '--partition') {
      options.partition = parseInt(args[++i], 10);
    } else if (arg === '-b' || arg === '--broker' || arg === '--brokers') {
      options.broker = args[++i];
    } else if (arg === '--use-sample') {
      options.useSample = true;
    } else if (arg === '--set' || arg === '-s') {
      const pair = args[++i];
      if (pair && pair.includes('=')) {
        const [k, v] = pair.split('=', 2);
        options.setFields[k.trim()] = v.trim();
      }
    } else if (arg === '--force-danger-confirm') {
      options.forceDangerConfirm = true;
    } else if (arg === '--save') {
      options.save = true;
    } else if (!options.topic && !arg.startsWith('-')) {
      options.topic = arg;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
🚀 Leo Kafka Producer - 模拟投递命令用法:

  node scripts/kafka_send.js -t <topic|别名|关键词> [选项]

选项:
  -t, --topic <name>          目标 Topic 名称、中文别名或关键词 (必填)
  -e, --env <test|prod>       目标环境: test(测试环境, 默认) 或 prod(生产环境)
  -d, --data <json>           待投递的消息体内容 (JSON 或纯字符串)
  -k, --key <string>          消息 Key (可选，用于固定分区路由)
  -p, --partition <num>       直接指定目标写入分区 (可选)
  -b, --broker <hosts>        手动指定 Broker 地址 (覆盖配置)
  --use-sample                使用该 Topic 沉淀的标准 sample 样例作为底模
  -s, --set <k=v>             配合 sample 覆盖指定字段 (例如: -s status=已完成)
  --force-danger-confirm      生产环境强制确认标识 (投递至 prod 时必填)
  --save                      将当前配置沉淀至 ~/.shrimp 本地持久化配置
  -h, --help                  查看帮助

使用示例:
  # 1. 向测试环境投递一条工单测试消息
  node scripts/kafka_send.js -t 工单 -d '{"orderCode":"TEST-001","status":"已接单"}'

  # 2. 使用 Topic 内置的 sample 模板，仅修改工单号和状态并自动投递
  node scripts/kafka_send.js -t huiju-iot-service-order-event --use-sample -s orderCode=T99999 -s status=已取消

  # 3. 投递至指定分区
  node scripts/kafka_send.js -t live_score_test -p 0 -d '{"ping":"pong"}'
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

  // 1. 生产环境强风控拦截
  if (!isTest && !options.forceDangerConfirm) {
    console.error(`\n🚨 【高危拦截：生产环境写入防护】`);
    console.error(`------------------------------------------------------------------------`);
    console.error(`• 检测到您正在尝试向【线上生产环境 (PROD)】发送 Kafka 消息！`);
    console.error(`• 生产环境投递可能直接触发真实交易、用户短信、设备动作等严重业务行为。`);
    console.error(`• 如因排障或特殊压测确实需要执行，请显式追加参数:`);
    console.error(`   --force-danger-confirm\n`);
    process.exit(1);
  }

  // 2. 解析目标 Topic 与 Broker
  let resolved = resolveTopic(options.topic, options.env);
  let targetTopic = resolved ? resolved.targetTopic : options.topic;
  let targetBrokers = options.broker ? cleanBrokers(options.broker) : (resolved ? resolved.broker : []);

  if (targetBrokers.length === 0) {
    console.error(`❌ 未能自动解析到 Topic [${options.topic}] 对应的 Kafka Broker 地址！`);
    console.error(`💡 建议：请手动使用 -b <broker:9092> 指定 Broker 地址。`);
    process.exit(1);
  }

  // 3. 构建消息 Payload
  let payloadObj = null;
  let payloadStr = '';

  if (options.data) {
    payloadStr = options.data;
    try {
      payloadObj = JSON.parse(options.data);
    } catch {
      payloadObj = null;
    }
  } else if (options.useSample || Object.keys(options.setFields).length > 0) {
    if (!resolved?.sample) {
      console.error(`❌ Topic [${targetTopic}] 尚未沉淀 sample 样例模板，请通过 -d '{"xxx":"yyy"}' 手动传入内容。`);
      process.exit(1);
    }
    payloadObj = JSON.parse(JSON.stringify(resolved.sample));
  } else {
    console.error(`❌ 请提供待发送的消息体内容: -d '<json>' 或使用 --use-sample`);
    process.exit(1);
  }

  // 如果存在模板与替换字段
  if (payloadObj && typeof payloadObj === 'object') {
    for (const [k, v] of Object.entries(options.setFields)) {
      payloadObj[k] = v;
    }
    // 自动刷新常见的时间戳字段
    if ('eventTime' in payloadObj) payloadObj.eventTime = Date.now();
    if ('timestamp' in payloadObj) payloadObj.timestamp = Date.now();
    payloadStr = JSON.stringify(payloadObj);
  }

  // 4. 保存至本地
  if (options.save) {
    saveTopicToLocal(targetTopic, {
      desc: resolved?.desc || `${targetTopic} (投递保存)`,
      app: resolved?.app || 'custom',
      [isTest ? 'test' : 'prod']: targetBrokers.join(','),
      sample: payloadObj || undefined
    });
    console.log(`💾 已将 Topic 与消息样本记忆至 ~/.shrimp/skills/live-inspector/kafka_catalog.json\n`);
  }

  console.log(`========================================================================`);
  console.log(`🚀 Leo Kafka 消息投递引擎 (Safe Producer)`);
  console.log(`========================================================================`);
  console.log(`• 目标主题 (Topic):   ${targetTopic} ${resolved?.desc ? `(${resolved.desc})` : ''}`);
  console.log(`• 投递环境 (Env):     ${envLabel}`);
  console.log(`• 目标集群 (Broker):  ${targetBrokers.join(', ')}`);
  if (options.key) console.log(`• 路由键值 (Key):     ${options.key}`);
  if (options.partition !== null) console.log(`• 指定分区 (Partition): P${options.partition}`);
  console.log(`• 消息内容 (Payload):`);
  try {
    console.log(JSON.stringify(JSON.parse(payloadStr), null, 2));
  } catch {
    console.log(payloadStr);
  }
  console.log(`========================================================================\n`);

  const kafka = createKafkaClient({
    brokers: targetBrokers,
    clientId: `leo-producer-${Date.now()}`
  });

  const producer = kafka.producer();
  const startTime = Date.now();

  try {
    await producer.connect();
    
    const messageRecord = {
      value: payloadStr,
    };
    if (options.key) messageRecord.key = options.key;
    if (options.partition !== null && !isNaN(options.partition)) {
      messageRecord.partition = options.partition;
    }

    const recordMetadata = await producer.send({
      topic: targetTopic,
      messages: [messageRecord]
    });

    const elapsed = Date.now() - startTime;
    await producer.disconnect();

    console.log(`🎉 消息成功写入 Kafka Broker！耗时: ${elapsed}ms\n`);
    for (const meta of recordMetadata) {
      console.log(`  📍 Partition:      P${meta.partition}`);
      console.log(`  📌 BaseOffset:     ${meta.baseOffset}`);
      console.log(`  🏷️  TopicName:      ${meta.topicName}`);
    }
    console.log();
  } catch (err) {
    console.error(`❌ 投递失败:`, err.message);
    try { await producer.disconnect(); } catch {}
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 执行异常:', err.message);
  process.exit(1);
});
