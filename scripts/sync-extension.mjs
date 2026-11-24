#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const SRC_DIR = path.join(projectRoot, 'extensions/leo-cookie-txt-locally');

if (!fs.existsSync(SRC_DIR)) {
  console.error(`❌ 源目录不存在: ${SRC_DIR}`);
  process.exit(1);
}

const targets = [
  // 1. 本地 gateway 内部技能
  path.join(projectRoot, 'lib/skills/leo-live-inspector/resources/chrome_extension'),
  // 2. 本地用户全局 .agents / .gemini / .claude 技能目录
  path.join(os.homedir(), '.agents/skills/leo-live-inspector/resources/chrome_extension'),
  path.join(os.homedir(), '.gemini/config/skills/leo-live-inspector/resources/chrome_extension'),
  path.join(os.homedir(), '.claude/skills/leo-live-inspector/resources/chrome_extension'),
  // 3. 本地 worktrees
  path.join(projectRoot, '.worktrees/feat-cloudflare-tunnel-p2p/extensions/leo-cookie-txt-locally'),
  path.join(projectRoot, '.worktrees/hindsight-config-restart-safe/extensions/leo-cookie-txt-locally'),
  // 4. macOS 下 leo-live-runner
  '/Users/pa/project/LEO/leo-live-runner/skills/leo-live-inspector/resources/chrome_extension',
  // 5. Windows 下 leo-live-runner
  'D:/Java Project/Leo/leo-live-runner/skills/leo-live-inspector/resources/chrome_extension',
  // 6. macOS 下 smart-customer-service
  '/Users/pa/project/IOT/KF/SCS/smart-customer-service/smart-customer-service-start/src/main/resources/extension/token-bridge',
  '/Users/pa/project/IOT/KF/SCS/smart-customer-service/smart-customer-service-start/target/classes/extension/token-bridge',
  // 7. Windows 下 smart-customer-service (常见工作区路径兜底)
  'D:/Java Project/KF/SCS/smart-customer-service/smart-customer-service-start/src/main/resources/extension/token-bridge',
];

console.log(`📦 [Leo Extension] 开始全量同步扩展主源 -> 目标工程...`);

for (const dst of targets) {
  try {
    const parentDir = path.dirname(dst);
    if (fs.existsSync(parentDir)) {
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(dst, { recursive: true });
      }
      fs.cpSync(SRC_DIR, dst, { recursive: true, force: true });
      console.log(`✅ 已同步至: ${dst}`);

      // 如果目标是 SCS 项目，自动触发 zip 重新打包
      if (dst.includes('smart-customer-service')) {
        const scsRoot = dst.split('smart-customer-service-start')[0];
        const buildScript = path.join(scsRoot, 'build-token-bridge.mjs');
        if (fs.existsSync(buildScript)) {
          console.log(`🔨 触发 SCS 扩展自动打包: ${buildScript}`);
          execSync(`node "${buildScript}"`, { cwd: scsRoot, stdio: 'inherit' });
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ 同步到 ${dst} 失败: ${err.message}`);
  }
}

console.log(`🎉 扩展同步流程完成！`);
