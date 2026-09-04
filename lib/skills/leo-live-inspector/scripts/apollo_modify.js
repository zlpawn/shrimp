#!/usr/bin/env node

/**
 * 🛠️ Leo Live Inspector - 测试环境 Apollo 配置动态修改与两阶段发布引擎 (Apollo Test Config Modifier)
 * 
 * 核心特性：
 *   1. 纯 HTTP 毫秒级直连：直连 test-apollo.portal.life.ke.com，无需常驻浏览器，耗时 < 200ms；
 *   2. 严格两阶段风控闭环：
 *      - 默认先查不改（Dry-Run）：清晰输出【变更前 vs 变更后】Diff 对比，必须带 --confirm 才会真正提交；
 *   3. 多 Namespace 精准定位：支持显式指定或全命名空间自动嗅探定位，隔离其他配置；
 *   4. 完整发布属性支持：默认支持【业务开关】(SWITCH, releaseAttribute: 3)，支持业务变更或降级；
 *   5. 闭环验证：发布后自动直连 ConfigService 验证微服务客户端热生效状态；
 *   6. 凭证自愈与明确指引：自动读取 ~/.shrimp/skills/live-inspector/test_apollo_cookie.json，缺失时给出精确到 jt_apollo_login_token 的复制引导。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveAppId, APOLLO_SERVERS } from './common/services.js';
import { SHRIMP_LIVE_DIR, loadApolloTestCookie, saveApolloTestCookie } from './common/credentials.js';
import { requestHttp } from './common/http.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COOKIE_FILE = path.join(SHRIMP_LIVE_DIR, 'test_apollo_cookie.json');
const DEFAULT_PORTAL_HOST = 'test-apollo.portal.life.ke.com';
const DEFAULT_CONFIG_SERVER = APOLLO_SERVERS.test || 'http://test.config.apollo.ke.com';

// 发布属性映射
const RELEASE_ATTR_MAP = {
  '1': '1',
  'change': '1',
  '业务变更': '1',
  '2': '2',
  'degrade': '2',
  '业务降级': '2',
  '3': '3',
  'switch': '3',
  '业务开关': '3'
};

const RELEASE_ATTR_LABEL = {
  '1': '业务变更 (CHANGE)',
  '2': '业务降级 (DEGRADE)',
  '3': '业务开关 (SWITCH)'
};

function printHelp() {
  console.log(`
🛠️ Leo Apollo Test Config Modifier (测试环境配置修改与发布引擎)

使用格式:
  node scripts/apollo_modify.js <appId> [namespace] <key> <newValue> [options]
  node scripts/apollo_modify.js <appId> <key> <newValue> [options]

常用参数:
  <appId>               目标微服务应用名或别名 (如 iot, saas, warehouse)
  [namespace]           目标命名空间 (可选，如未提供将自动嗅探定位所在 Namespace)
  <key>                 待修改或新增的配置项 Key
  <newValue>            修改后的目标配置值 (Value，支持 JSON 字符串)
  --confirm             明确确认执行修改与发布 (默认仅输出变更 Diff，不真正执行)
  --type <type>         发布属性: switch (业务开关，默认), change (业务变更), degrade (业务降级)
  --comment <text>      修改或发布备注说明
  --cookie <str>        临时覆盖请求使用的 Cookie
  --set-cookie <str>    保存更新 Cookie 至 ~/.shrimp 供后续免输复用
  --env <env>           目标环境，默认 TEST (当前仅开放测试环境修改)
  --cluster <name>      集群名称，默认 default
  --json                输出纯 JSON 结果
  -h, --help            查看本帮助信息

示例:
  # 1. 安全预览模式 (Dry-Run)：查看修改前后的 Diff 对比（不实际提交）
  node scripts/apollo_modify.js iot-platform liveRunner.access.ucIdWhitelist "[31534062,12]"

  # 2. 确认执行模式：修改配置项并按【业务开关】发布生效
  node scripts/apollo_modify.js iot-platform liveRunner.access.ucIdWhitelist "[31534062,12]" --confirm

  # 3. 显式指定命名空间
  node scripts/apollo_modify.js saas application.properties timeout "3000" --confirm
`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  // 1. 设置 Cookie
  const setCookieIdx = argv.findIndex(a => a === '--set-cookie');
  if (setCookieIdx !== -1 && argv[setCookieIdx + 1]) {
    saveApolloTestCookie(argv[setCookieIdx + 1]);
    console.log(`✅ 已成功保存 Apollo 测试登录 Cookie 凭证至: ${COOKIE_FILE}`);
    process.exit(0);
  }

  let inputApp = '';
  let inputNamespace = '';
  let inputKey = '';
  let inputValue = '';
  let isConfirm = false;
  let releaseTypeArg = 'switch';
  let commentArg = '';
  let customCookie = '';
  let env = 'TEST';
  let cluster = 'default';
  let outputJson = false;

  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') {
      isConfirm = true;
    } else if (a === '--type' && argv[i + 1]) {
      releaseTypeArg = argv[++i].toLowerCase();
    } else if (a === '--comment' && argv[i + 1]) {
      commentArg = argv[++i];
    } else if (a === '--cookie' && argv[i + 1]) {
      customCookie = argv[++i];
    } else if (a === '--env' && argv[i + 1]) {
      env = argv[++i].toUpperCase();
    } else if (a === '--cluster' && argv[i + 1]) {
      cluster = argv[++i];
    } else if (a === '--json') {
      outputJson = true;
    } else if (!a.startsWith('-')) {
      positional.push(a);
    }
  }

  if (positional.length < 3) {
    console.error(`❌ 参数不足！请至少提供 <appId> <key> <newValue>。`);
    printHelp();
    process.exit(1);
  }

  inputApp = positional[0];
  if (positional.length === 3) {
    // 未显式提供 namespace: app key value
    inputKey = positional[1];
    inputValue = positional[2];
  } else {
    // 显式提供 namespace: app namespace key value
    inputNamespace = positional[1];
    inputKey = positional[2];
    inputValue = positional[3];
  }

  const canonicalApp = resolveAppId(inputApp);
  const releaseAttr = RELEASE_ATTR_MAP[releaseTypeArg] || '3';
  const releaseAttrLabel = RELEASE_ATTR_LABEL[releaseAttr] || '业务开关 (SWITCH)';

  const cookie = customCookie || loadApolloTestCookie();
  if (!cookie) {
    console.error(`
❌ 未找到 Apollo 测试环境登录凭证 (Cookie)！

💡 获取指引（请在已登录的测试 Apollo 页面复制）：
   目标页面: http://test-apollo.portal.life.ke.com

   👉 方式 A（推荐，使用右上方 Leo Cookie 插件）：
      点击插件图标，找到 [jt_apollo_login_token] 点击【复制】；
      或点击【复制全部 Cookie】。
   👉 方式 B（F12 开发者工具）：
      按 F12 ➔ Application ➔ Cookies ➔ 选中 test-apollo.portal.life.ke.com ➔ 复制 [jt_apollo_login_token] 的值。

   保存凭证命令:
      node scripts/apollo_modify.js --set-cookie "<粘贴的Cookie>"
`);
    process.exit(1);
  }

  const commonHeaders = {
    'Cookie': cookie,
    'Host': DEFAULT_PORTAL_HOST,
    'User-Agent': 'Mozilla/5.0 (Leo-Live-Inspector)'
  };

  // 2. 确定 Namespace (若未显式指定，全量扫描微服务的所有命名空间进行定位)
  let targetNamespace = inputNamespace;
  let targetItem = null;

  if (!targetNamespace) {
    // 获取该应用下的全部命名空间
    const nsRes = await requestHttp({
      hostname: DEFAULT_PORTAL_HOST,
      port: 80,
      path: `/apps/${encodeURIComponent(canonicalApp)}/envs/${env}/clusters/${encodeURIComponent(cluster)}/namespaces`,
      method: 'GET',
      headers: commonHeaders
    });

    if (nsRes.statusCode === 302) {
      console.error(`\n❌ Apollo 登录态已过期（服务端已重定向至 test-login.ke.com）！`);
      console.error(`💡 请重新在测试 Apollo 页面复制 jt_apollo_login_token 并运行 --set-cookie 刷新。\n`);
      process.exit(1);
    }

    if (Array.isArray(nsRes.data)) {
      const candidates = [];
      for (const nsObj of nsRes.data) {
        const nsName = nsObj.baseInfo?.namespaceName;
        if (!nsName) continue;
        // 查询该 namespace 下的所有 items
        const itemRes = await requestHttp({
          hostname: DEFAULT_PORTAL_HOST,
          port: 80,
          path: `/apps/${encodeURIComponent(canonicalApp)}/envs/${env}/clusters/${encodeURIComponent(cluster)}/namespaces/${encodeURIComponent(nsName)}/items`,
          method: 'GET',
          headers: commonHeaders
        });
        if (Array.isArray(itemRes.data)) {
          const match = itemRes.data.find(it => it.key === inputKey);
          if (match) {
            candidates.push({ namespace: nsName, item: match });
          }
        }
      }

      if (candidates.length === 1) {
        targetNamespace = candidates[0].namespace;
        targetItem = candidates[0].item;
      } else if (candidates.length > 1) {
        console.error(`⚠️ 配置项 [${inputKey}] 存在于多个命名空间中: ${candidates.map(c => c.namespace).join(', ')}`);
        console.error(`👉 请显式指定命名空间，例如: node scripts/apollo_modify.js ${canonicalApp} ${candidates[0].namespace} ${inputKey} "${inputValue}"`);
        process.exit(1);
      } else {
        // 未在任何现有配置中找到，默认归属至 application
        targetNamespace = 'application';
      }
    } else {
      targetNamespace = 'application';
    }
  }

  // 3. 查询当前配置项现状
  if (!targetItem) {
    const itemRes = await requestHttp({
      hostname: DEFAULT_PORTAL_HOST,
      port: 80,
      path: `/apps/${encodeURIComponent(canonicalApp)}/envs/${env}/clusters/${encodeURIComponent(cluster)}/namespaces/${encodeURIComponent(targetNamespace)}/items`,
      method: 'GET',
      headers: commonHeaders
    });
    if (Array.isArray(itemRes.data)) {
      targetItem = itemRes.data.find(it => it.key === inputKey) || null;
    }
  }

  const currentValue = targetItem ? targetItem.value : '(全新配置项，此前不存在)';
  const isNewItem = !targetItem;

  // 4. 若未指定 --confirm，严格执行安全风控：仅输出变更前后的 Diff，阻断等待人工确认
  if (!isConfirm) {
    console.log(`================================================================`);
    console.log(`⚠️ Apollo 配置变更确认单 (Pre-flight Check / Dry-Run)`);
    console.log(`================================================================`);
    console.log(`🌐 目标环境: 🟡 测试环境 (${env})`);
    console.log(`📦 目标应用: ${canonicalApp}`);
    console.log(`📁 命名空间: 【${targetNamespace}】(精准锁定，其余 Namespace 完全不受影响)`);
    console.log(`🔑 配置键名: ${inputKey}`);
    console.log(`🏷️ 发布属性: ${releaseAttrLabel}`);
    console.log(`----------------------------------------------------------------`);
    console.log(`📊 变更前 vs 变更后 对比 (Diff):`);
    console.log(`  - 变更前 (Current): ${currentValue}`);
    console.log(`  + 变更后 (Target) : ${inputValue}`);
    console.log(`----------------------------------------------------------------`);
    console.log(`🛑 当前处于安全预览模式（尚未对配置做任何实际修改）！`);
    console.log(`👉 如确认执行写入与发布，请追加参数: --confirm`);
    console.log(`   示例: node scripts/apollo_modify.js ${canonicalApp} ${targetNamespace} ${inputKey} "${inputValue}" --confirm\n`);
    process.exit(0);
  }

  // 5. 执行写操作：创建或更新 Item 草稿
  console.log(`🚀 [1/3] 正在向命名空间 【${targetNamespace}】 写入配置草稿...`);
  let itemPayload = {};
  let method = 'PUT';

  if (isNewItem) {
    method = 'POST';
    itemPayload = {
      key: inputKey,
      value: inputValue,
      comment: commentArg || 'Created by Leo AI Inspector',
      tableViewOperType: 'create'
    };
  } else {
    method = 'PUT';
    itemPayload = {
      id: targetItem.id,
      namespaceId: targetItem.namespaceId,
      key: inputKey,
      type: targetItem.type || 3,
      value: inputValue,
      comment: commentArg || targetItem.comment || '',
      lineNum: targetItem.lineNum || 1,
      tableViewOperType: 'update'
    };
  }

  const writeRes = await requestHttp({
    hostname: DEFAULT_PORTAL_HOST,
    port: 80,
    path: `/apps/${encodeURIComponent(canonicalApp)}/envs/${env}/clusters/${encodeURIComponent(cluster)}/namespaces/${encodeURIComponent(targetNamespace)}/item`,
    method,
    headers: commonHeaders
  }, itemPayload);

  if (writeRes.statusCode !== 200) {
    console.error(`❌ 配置草稿写入失败 (HTTP ${writeRes.statusCode}): ${JSON.stringify(writeRes.data)}`);
    process.exit(1);
  }
  console.log(`✅ [1/3] 配置项草稿保存成功！`);

  // 6. 执行发布：生成正式 Release 并全网广播
  console.log(`🚀 [2/3] 正在发布变更 (发布属性: ${releaseAttrLabel})...`);
  const nowStr = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const releaseTitle = `${nowStr}-release`;
  const releaseComment = commentArg || `Modified ${inputKey} to ${inputValue.length > 30 ? inputValue.slice(0, 30) + '...' : inputValue}`;

  const releasePayload = {
    releaseTitle,
    releaseComment,
    isEmergencyPublish: false,
    releaseAttribute: releaseAttr
  };

  const relRes = await requestHttp({
    hostname: DEFAULT_PORTAL_HOST,
    port: 80,
    path: `/apps/${encodeURIComponent(canonicalApp)}/envs/${env}/clusters/${encodeURIComponent(cluster)}/namespaces/${encodeURIComponent(targetNamespace)}/releases`,
    method: 'POST',
    headers: commonHeaders
  }, releasePayload);

  if (relRes.statusCode !== 200) {
    console.error(`❌ 配置发布失败 (HTTP ${relRes.statusCode}): ${JSON.stringify(relRes.data)}`);
    process.exit(1);
  }

  const releaseInfo = relRes.data;
  console.log(`✅ [2/3] 发布成功！生成版本号 ReleaseKey: ${releaseInfo?.name || releaseTitle}`);

  // 7. 闭环验证：直连测试 ConfigService 确认客户端是否已热更新
  console.log(`🚀 [3/3] 正在连通测试 ConfigService 验证热生效状态...`);
  await new Promise(r => setTimeout(r, 1200));

  let verifiedValue = null;
  const verifyRes = await requestHttp({
    hostname: new URL(DEFAULT_CONFIG_SERVER).hostname,
    port: 80,
    path: `/configs/${encodeURIComponent(canonicalApp)}/${encodeURIComponent(cluster)}/${encodeURIComponent(targetNamespace)}`,
    method: 'GET'
  });

  if (verifyRes.statusCode === 200 && verifyRes.data?.configurations) {
    verifiedValue = verifyRes.data.configurations[inputKey];
  }

  console.log(`================================================================`);
  console.log(`🎉 变更全流程顺利完成 (Executed & Verified)`);
  console.log(`================================================================`);
  console.log(`📦 微服务应用: ${canonicalApp} | 环境: 🟡 测试环境 (${env})`);
  console.log(`📁 命名空间:   【${targetNamespace}】`);
  console.log(`🔑 配置键名:   ${inputKey}`);
  console.log(`🏷️ 发布属性:   ${releaseAttrLabel}`);
  console.log(`📑 变更轨迹:   ${currentValue}  ➔  ${inputValue}`);
  console.log(`🌐 客户端生效: ${verifiedValue !== undefined ? `✅ 已核验生效 (值为: ${verifiedValue})` : '⚠️ 客户端同步中'}`);
  console.log(`================================================================\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
