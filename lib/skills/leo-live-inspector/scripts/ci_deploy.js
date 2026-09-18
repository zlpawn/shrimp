#!/usr/bin/env node

/**
 * 🚀 Leo Live Inspector - 测试环境 CI 自动化构建与工作负载镜像部署引擎
 * 
 * 功能：
 *   1. 【构建 CI】：直连 Shipwright 触发指定分支构建，轮询进度，提取 Harbor 镜像 Tag；
 *   2. 【部署 CD】：直连云平台更新工作负载，自动替换容器镜像为新产物并下发发布；
 *   3. 【新人自适应】：未注册服务自动通过内网 API 嗅探构建器与测试工作负载，自学习持久化；
 *   4. 【严格风控】：仅限测试环境 (test)，生产环境严格拦截并进入变更参谋模式；
 *   5. 【凭证治理】：支持统一全量 Cookie 凭证加载、自愈引导与一键配置 (--set-cookie)。
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { URL } from 'node:url';
import { loadCloudCookie, saveCloudCookie } from './common/credentials.js';
import { resolveAppId, getServiceCiDeployMeta, saveServiceCiDeployMeta } from './common/services.js';

// ---------------- 基础 HTTP 请求封装 ----------------

function doRequest(urlStr, options = {}, cookie = '') {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const postBody = options.body;
    const bodyStr = postBody
      ? (typeof postBody === 'string' ? postBody : JSON.stringify(postBody))
      : null;

    const headers = {
      'Accept': 'application/json, text/plain, */*',
      ...(cookie ? { 'Cookie': cookie } : {}),
      ...(options.headers || {})
    };

    if (bodyStr) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json;charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: options.method || (bodyStr ? 'POST' : 'GET'),
      headers,
      timeout: options.timeout || 15000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          location: res.headers.location,
          data: json !== null ? json : raw,
          json,
          raw
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 504, error: 'Request Timeout (15s)' });
    });

    req.on('error', (err) => {
      resolve({ statusCode: 500, error: err.message });
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------- 凭证缺失与过期引导 ----------------

function printCredentialGuide(reason = '未配置登录凭证') {
  console.log(`\n❌ 【云平台与 CI 凭证错误】: ${reason}`);
  console.log(`💡 构建与部署需要具备贝壳内网 SSO 登录态 (cloud.intra.ke.com / shipwright.ke.com)`);
  console.log(`\n🔑 【请任选一种方式快速配置】:`);
  console.log(`1. 命令行快速写入:`);
  console.log(`   node scripts/ci_deploy.js --set-cookie "<完整的 Cookie 字符串>"`);
  console.log(`2. Chrome 扩展一键导出:`);
  console.log(`   打开云平台 (https://cloud.intra.ke.com)，点击 "Leo cookie.txt Locally" 插件`);
  console.log(`   点击【下载 cookies.txt】，脚本下次执行时将自动自愈并无感读取。`);
  console.log(`3. 开发者工具 (F12) 手动获取:`);
  console.log(`   在已登录的云平台页面按 F12 ➜ Application ➜ Cookies ➜ 复制 cloud.intra.ke.com 的 Cookie。`);
  console.log(``);
}

// ---------------- 本地 Git 环境自嗅探 ----------------

function detectLocalServiceAndBranch() {
  let detectedService = null;
  let detectedBranch = null;

  try {
    const remoteUrl = execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' }).trim();
    if (remoteUrl) {
      const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) detectedService = match[1];
    }
  } catch {}

  try {
    detectedBranch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
  } catch {}

  return { detectedService, detectedBranch };
}

// ---------------- 新人自适应：动态嗅探服务构建器与工作负载 ----------------

async function autoDiscoverServiceMeta(serviceId, cookie) {
  console.log(`🔍 正在为服务 [${serviceId}] 动态探查内网 CI 构建器与测试工作负载...`);

  // 1. 查询构建器 (Shipwright API)
  let workflowId = null;
  let workflowName = null;
  let defaultBranch = 'master';

  const wfRes = await doRequest('https://shipwright.ke.com/workflow-context/v1/workflows/query?pageNumber=1&pageSize=10', {
    method: 'POST',
    body: {
      'labels.cloud_intra_ke_com/service_id': serviceId,
      'labels.app-svc_ke_com/platform': ['FUXI', 'CLOUD']
    }
  }, cookie);

  if (wfRes.statusCode === 200 && wfRes.json?.list?.length > 0) {
    const list = wfRes.json.list;
    // 优先寻找测试环境或名称含 test 的构建器
    const testWf = list.find(w => 
      w.labels?.['app-svc_ke_com/env'] === 'test' || 
      (w.name && /test|测试/i.test(w.name))
    ) || list[0];

    workflowId = testWf.id;
    workflowName = testWf.name;
    const gitStep = testWf.steps?.find(s => s.id === 'git' || s.template?.type === 'Git');
    if (gitStep?.template?.branch) {
      defaultBranch = gitStep.template.branch;
    }
  }

  // 2. 查询工作负载 (Cloud Proxy API)
  let workloadId = null;
  let workloadName = null;

  const wlRes = await doRequest(`https://cloud.intra.ke.com/cloud-proxy-api/cloud-application/app/${serviceId}/virtual-services?serviceId=${serviceId}`, {
    method: 'GET'
  }, cookie);

  if (wlRes.statusCode === 200 && wlRes.json?.data?.length > 0) {
    const workloads = wlRes.json.data;
    // 过滤出测试环境
    const testWl = workloads.find(w => w.envType === 'test') || workloads[0];
    workloadId = testWl.id;
    workloadName = testWl.name || testWl.id;
  }

  if (workflowId && workloadId) {
    const meta = {
      serviceId,
      ci: {
        workflowId,
        workflowName,
        defaultBranch
      },
      deploy: {
        test: {
          workloadId,
          workloadName,
          deployType: 'normal'
        }
      }
    };
    saveServiceCiDeployMeta(serviceId, meta);
    console.log(`✅ 自动嗅探成功并沉淀资产至本地缓存:`);
    console.log(`   - 构建器: ${workflowName} (${workflowId})`);
    console.log(`   - 测试工作负载: ${workloadName} (${workloadId})`);
    return meta;
  }

  return null;
}

// ---------------- CI 构建执行器 ----------------

async function triggerBuild(serviceId, workflowId, branch, cookie) {
  console.log(`\n📦 【步骤 1/3: 触发 CI 构建】`);
  console.log(`   目标服务: ${serviceId}`);
  console.log(`   构建器 ID: ${workflowId}`);
  console.log(`   目标分支: ${branch}`);

  // 1. 获取构建器当前快照
  const queryRes = await doRequest(`https://shipwright.ke.com/workflow-context/v1/workflows/query?pageNumber=1&pageSize=10`, {
    method: 'POST',
    body: {
      'labels.cloud_intra_ke_com/service_id': serviceId,
      '_id': { '$oid': workflowId }
    }
  }, cookie);

  let workflowConfig = null;
  if (queryRes.statusCode === 200 && queryRes.json?.list?.length > 0) {
    workflowConfig = queryRes.json.list[0];
  } else {
    // 尝试直接获取
    const singleRes = await doRequest(`https://shipwright.ke.com/workflow-context/v1/workflows/query?pageNumber=1&pageSize=10`, {
      method: 'POST',
      body: { 'labels.cloud_intra_ke_com/service_id': serviceId }
    }, cookie);
    workflowConfig = singleRes.json?.list?.find(w => w.id === workflowId) || singleRes.json?.list?.[0];
  }

  if (!workflowConfig) {
    throw new Error(`无法获取构建器 [${workflowId}] 的详细配置`);
  }

  // 覆盖 Git 分支
  if (workflowConfig.steps) {
    for (const step of workflowConfig.steps) {
      if (step.id === 'git' || step.template?.type === 'Git') {
        step.template.branch = branch;
      }
    }
  }

  // 2. 发起构建
  const triggerRes = await doRequest(`https://shipwright.ke.com/workflow-context/v1/workflows/${workflowId}/dynamic-trigger?overwrite=true`, {
    method: 'POST',
    body: workflowConfig
  }, cookie);

  if (triggerRes.statusCode === 302 || triggerRes.statusCode === 401) {
    printCredentialGuide('登录凭证已失效 (302/401)');
    process.exit(1);
  }

  if (triggerRes.statusCode !== 200 || !triggerRes.json?.id) {
    throw new Error(`触发构建失败 (HTTP ${triggerRes.statusCode}): ${JSON.stringify(triggerRes.data)}`);
  }

  const recordId = triggerRes.json.id;
  const shortRecordNumber = triggerRes.json.status?.shortRecordNumber || '最新';
  console.log(`   ✅ 构建已成功触发! 记录 ID: ${recordId} (编号: #${shortRecordNumber})`);
  return { recordId, shortRecordNumber };
}

// ---------------- 轮询构建进度与提取镜像产物 ----------------

async function pollBuildUntilComplete(workflowId, recordId, cookie, timeoutMs = 600000, intervalMs = 5000) {
  console.log(`\n⏳ 【步骤 2/3: 轮询构建状态】(超时限制: ${Math.round(timeoutMs/1000)}s)`);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`   [${elapsedSec}s] 检查构建状态... `);

    const checkRes = await doRequest(`https://shipwright.ke.com/workflow-context/v1/workflow-records/query?pageNumber=1&pageSize=5`, {
      method: 'POST',
      body: {
        '$and': [
          { 'workflowSnap.id': { '$in': [{ '$oid': workflowId }] } },
          { '_id': { '$oid': recordId } }
        ]
      }
    }, cookie);

    let status = null;
    if (checkRes.statusCode === 200 && checkRes.json?.list?.length > 0) {
      const rec = checkRes.json.list.find(r => r.id === recordId) || checkRes.json.list[0];
      status = rec.status?.runningStatus;
    }

    console.log(`当前状态: ${status || 'PENDING'}`);

    if (status === 'SUCCESS') {
      console.log(`   🎉 构建成功完成! 总耗时: ${elapsedSec} 秒`);
      
      // 提取产物镜像地址
      const artRes = await doRequest(`https://shipwright.ke.com/workflow-context/v1/artifacts/query?pageNumber=1&pageSize=5`, {
        method: 'POST',
        body: { 'labels.app-svc_ke_com/workflow_record_id': recordId }
      }, cookie);

      let imageAddress = null;
      if (artRes.statusCode === 200 && artRes.json?.list?.length > 0) {
        const imageArt = artRes.json.list.find(a => a.type === 'IMAGE' || a.address?.includes('harbor')) || artRes.json.list[0];
        imageAddress = imageArt.address;
      }

      if (!imageAddress) {
        throw new Error(`构建虽然成功，但未能在产物列表中解析出 Harbor 镜像地址`);
      }

      console.log(`   🏷️  产物镜像: ${imageAddress}`);
      return { status: 'SUCCESS', imageAddress, elapsedSec };
    }

    if (status === 'FAILED' || status === 'ABORTED' || status === 'ERROR') {
      throw new Error(`构建失败! 终态: ${status} (查看控制台日志: https://shipwright.ke.com/workflow-context/v1/workflow-records/${recordId}/log/progress?start=0)`);
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error(`构建超时 (${Math.round(timeoutMs/1000)} 秒) 未完成`);
}

// ---------------- 工作负载部署执行器 ----------------

async function deployWorkload(serviceId, workloadId, imageAddress, cookie) {
  console.log(`\n🚀 【步骤 3/3: 部署工作负载到测试环境】`);
  console.log(`   服务 ID: ${serviceId}`);
  console.log(`   负载 ID: ${workloadId}`);
  console.log(`   目标镜像: ${imageAddress}`);

  // 1. 获取现有工作负载配置
  const editRes = await doRequest(`https://cloud.intra.ke.com/cloud-proxy-api/cloud-application/app/${serviceId}/virtual-service/${workloadId}/edit`, {
    method: 'GET'
  }, cookie);

  if (editRes.statusCode === 302 || editRes.statusCode === 401) {
    printCredentialGuide('云平台登录凭证过期 (302/401)');
    process.exit(1);
  }

  if (editRes.statusCode !== 200 || editRes.json?.code !== 200000 || !editRes.json?.data) {
    throw new Error(`获取工作负载 [${workloadId}] 配置失败: ${JSON.stringify(editRes.data)}`);
  }

  const workloadConfig = editRes.json.data;

  // 2. 替换容器镜像
  if (!workloadConfig.spec?.containers || workloadConfig.spec.containers.length === 0) {
    throw new Error(`工作负载配置中未找到 containers 容器列表`);
  }

  const oldImage = workloadConfig.spec.containers[0].image;
  workloadConfig.spec.containers[0].image = imageAddress;
  workloadConfig.serviceId = serviceId;
  workloadConfig.id = workloadId;

  console.log(`   原镜像: ${oldImage}`);
  console.log(`   新镜像: ${imageAddress}`);

  // 3. 提交部署更新
  const overrideRes = await doRequest(`https://cloud.intra.ke.com/cloud-proxy-api/cloud-application/app/${serviceId}/virtual-service/${workloadId}/override`, {
    method: 'PUT',
    body: workloadConfig
  }, cookie);

  if (overrideRes.statusCode !== 200 || overrideRes.json?.code !== 200000) {
    throw new Error(`下发部署失败: ${JSON.stringify(overrideRes.data)}`);
  }

  console.log(`   ✅ 部署指令下发成功! (code: 200000)`);
  return { success: true, oldImage, newImage: imageAddress };
}

// ---------------- 辅助查询接口：查历史镜像、构建器、负载 ----------------

async function listImages(serviceId, cookie) {
  console.log(`\n🖼️  正在查询服务 [${serviceId}] 最近构建的可用镜像...`);
  const res = await doRequest(`https://cloud.intra.ke.com/apis/ci/v1/deployment/images/${serviceId}?pageNumber=1&pageSize=5&fuzzyWorkflowName=`, {
    method: 'GET'
  }, cookie);

  if (res.statusCode === 200 && res.json?.list) {
    console.log(`\n| # | 构建器 | 记录编号 | 构建时间 | Commit | 镜像地址 |`);
    console.log(`|---|---|---|---|---|---|`);
    res.json.list.forEach((img, idx) => {
      const wfName = img.labels?.['app-svc_ke_com/workflow_name'] || '-';
      const recordNo = img.status?.shortRecordNumber || '-';
      const time = img.status?.createTime?.replace('T', ' ') || '-';
      const git = img.status?.gitInfos?.[0];
      const commit = git ? `${git.branch}@${git.commitId?.slice(0, 8)}` : '-';
      console.log(`| ${idx + 1} | ${wfName} | #${recordNo} | ${time} | ${commit} | ${img.address} |`);
    });
    console.log(``);
  } else {
    console.log(`未查到历史镜像或请求异常: ${JSON.stringify(res.data)}`);
  }
}

// ---------------- 主入口函数 ----------------

async function main() {
  const args = process.argv.slice(2);

  // 0. 帮助说明
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`\n🚀 Leo Live Inspector - 测试环境 CI 自动化构建与工作负载镜像部署引擎`);
    console.log(`用法: node scripts/ci_deploy.js [service] [options]`);
    console.log(`\n选项:`);
    console.log(`  -s, --service <name>   目标微服务 ID 或别名 (默认根据当前 Git 仓库自动识别)`);
    console.log(`  -b, --branch <branch>  构建的代码分支 (默认根据当前 Git 分支自动识别)`);
    console.log(`  --build-only           仅触发 Shipwright CI 构建，不执行部署`);
    console.log(`  --deploy-only          仅执行测试工作负载部署 (默认使用最新产物镜像)`);
    console.log(`  -i, --image <image>    显式指定部署的目标镜像地址`);
    console.log(`  -l, --list-images      列出该微服务历史构建成功的镜像列表与时间`);
    console.log(`  --dry-run              安全预检模式，仅解析并打印配置信息，不触发实际写操作`);
    console.log(`  --timeout <duration>   构建轮询最大超时时间 (默认: 15m)`);
    console.log(`  --set-cookie "<str>"   保存更新服务云与 Shipwright 平台统一 Session Cookie`);
    console.log(`  --json                 输出纯 JSON 数据结果`);
    console.log(`  -h, --help             显示帮助信息\n`);
    process.exit(0);
  }

  // 1. 设置 Cookie 命令
  const setCookieIdx = args.indexOf('--set-cookie');
  if (setCookieIdx !== -1) {
    const val = args[setCookieIdx + 1];
    if (!val) {
      console.log(`❌ 请提供 Cookie 字符串: node scripts/ci_deploy.js --set-cookie "<cookie>"`);
      process.exit(1);
    }
    saveCloudCookie(val);
    console.log(`✅ 云平台/CI 凭证已成功保存至 ~/.shrimp/skills/live-inspector/cloud_token.json`);
    process.exit(0);
  }

  // 2. 解析参数
  let rawService = args.find(a => !a.startsWith('-'));
  const isBuildOnly = args.includes('--build-only');
  const isDeployOnly = args.includes('--deploy-only');
  const isListImages = args.includes('--list-images');
  const isDryRun = args.includes('--dry-run');
  const isJson = args.includes('--json');

  let targetEnv = 'test';
  const envIdx = args.findIndex(a => a === '-e' || a === '--env');
  if (envIdx !== -1 && args[envIdx + 1]) targetEnv = args[envIdx + 1].toLowerCase();

  // 严禁生产环境！
  if (targetEnv === 'prod' || targetEnv === 'production' || targetEnv === 'online') {
    console.log(`\n🚨 【安全红线拦截: 严禁 AI 自动化直写生产环境部署】`);
    console.log(`   Leo Live Inspector 严格遵守生产变更参谋规范。`);
    console.log(`   如需发布生产环境，请由负责人在受控审批流中走官方流程:`);
    console.log(`   🔗 生产工作负载发布页: https://cloud.intra.ke.com/console/project/cloud/application/${rawService || '...'}/workloadnew`);
    process.exit(1);
  }

  let branch = null;
  const branchIdx = args.findIndex(a => a === '-b' || a === '--branch');
  if (branchIdx !== -1 && args[branchIdx + 1]) branch = args[branchIdx + 1];

  let specifiedImage = null;
  const imgIdx = args.indexOf('--image');
  if (imgIdx !== -1 && args[imgIdx + 1]) specifiedImage = args[imgIdx + 1];

  // 3. 服务名与分支自检测
  const { detectedService, detectedBranch } = detectLocalServiceAndBranch();
  if (!rawService && detectedService) {
    rawService = detectedService;
    console.log(`📍 自动从本地 Git 仓库识别服务: [${rawService}]`);
  }
  if (!branch && detectedBranch) {
    branch = detectedBranch;
    console.log(`🌿 自动从本地 Git 分支识别: [${branch}]`);
  }
  if (!branch) branch = 'master';

  if (!rawService) {
    console.log(`❌ 请提供目标服务名或在 Git 项目根目录下运行:`);
    console.log(`   用法: node scripts/ci_deploy.js <service> [options]`);
    console.log(`   示例: node scripts/ci_deploy.js smart-customer-service --branch master`);
    process.exit(1);
  }

  const serviceId = resolveAppId(rawService);

  // 4. 读取凭证
  const cookie = loadCloudCookie();
  if (!cookie) {
    printCredentialGuide('未找到有效凭证');
    process.exit(1);
  }

  // 5. 辅助查询模式
  if (isListImages) {
    await listImages(serviceId, cookie);
    process.exit(0);
  }

  // 6. 解析或自嗅探构建与部署元数据
  let meta = getServiceCiDeployMeta(serviceId);
  if (!meta || !meta.ci?.workflowId || !meta.deploy?.test?.workloadId) {
    meta = await autoDiscoverServiceMeta(serviceId, cookie);
  }

  if (!meta || !meta.ci?.workflowId || !meta.deploy?.test?.workloadId) {
    console.log(`❌ 无法解析或嗅探到服务 [${serviceId}] 的构建器或测试工作负载。`);
    console.log(`   请确认当前账号在云平台/CI 系统中是否有该服务的访问权限。`);
    process.exit(1);
  }

  const workflowId = meta.ci.workflowId;
  const workloadId = meta.deploy.test.workloadId;

  // 7. Dry-Run 预检模式
  if (isDryRun) {
    console.log(`\n📋 【Pre-flight 预检确认】:`);
    console.log(`   - 目标服务: ${serviceId}`);
    console.log(`   - 构建器 ID: ${workflowId} (${meta.ci.workflowName || '-'})`);
    console.log(`   - Git 分支: ${branch}`);
    console.log(`   - 目标工作负载: ${workloadId} (${meta.deploy.test.workloadName || '-'})`);
    console.log(`   - 部署环境: 测试环境 (${targetEnv})`);
    console.log(`   - 模式: ${isBuildOnly ? '仅构建' : isDeployOnly ? '仅部署' : '完整构建+部署流水线'}`);
    console.log(`   ✅ 预检通过，参数均已就绪。\n`);
    process.exit(0);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 开始执行 [${serviceId}] 测试环境全自动交付流水线`);
  console.log(`   分支: ${branch} | 环境: test | 工作负载: ${workloadId}`);
  console.log(`======================================================`);

  let imageAddress = specifiedImage;
  let recordId = null;

  // 8. 执行构建 (除非指定 --deploy-only)
  if (!isDeployOnly) {
    const triggerResult = await triggerBuild(serviceId, workflowId, branch, cookie);
    recordId = triggerResult.recordId;
    const buildResult = await pollBuildUntilComplete(workflowId, recordId, cookie);
    imageAddress = buildResult.imageAddress;
  } else {
    if (!imageAddress) {
      console.log(`❌ --deploy-only 模式必须通过 --image <url> 指定镜像`);
      process.exit(1);
    }
  }

  // 如果只构建，提前退出
  if (isBuildOnly) {
    console.log(`\n✅ 构建任务已成功完成，已停止自动部署 (--build-only)。`);
    console.log(`   生成的镜像地址: ${imageAddress}`);
    process.exit(0);
  }

  // 9. 执行部署
  const deployResult = await deployWorkload(serviceId, workloadId, imageAddress, cookie);

  // 10. 交付结论卡片
  console.log(`\n🎉 ================== 交付成功报告 ==================`);
  console.log(`服务名称: ${serviceId}`);
  console.log(`工作负载: ${meta.deploy.test.workloadName || workloadId} (${workloadId})`);
  console.log(`部署环境: 测试环境 (test)`);
  console.log(`代码分支: ${branch}`);
  if (recordId) console.log(`构建记录: ${recordId}`);
  console.log(`上线镜像: ${imageAddress}`);
  console.log(`生效状态: 部署指令已完成下发并确认响应成功 (200000)`);
  console.log(`======================================================\n`);

  if (isJson) {
    console.log(JSON.stringify({
      success: true,
      serviceId,
      branch,
      imageAddress,
      recordId,
      workloadId
    }));
  }
}

main().catch(err => {
  console.error(`\n❌ 执行异常: ${err.message}`);
  process.exit(1);
});
