#!/usr/bin/env node
import {
  checkOfmUpdate,
  updateOfmCoreFromGithub,
  DEFAULT_BIN_OFM_DIR,
} from "../lib/ofm/updater.mjs";
import { isPidAlive, readPid, start, stop } from "../lib/ofm/supervisor.mjs";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");

async function main() {
  if (checkOnly) {
    console.log("🔍 [OFM Updater] 正在通过本机代理检查 GitHub 最新版本...");
    const info = await checkOfmUpdate({ binOfmDir: DEFAULT_BIN_OFM_DIR });
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log("📦 [OFM Updater] 正在通过本机代理从 GitHub 拉取并更新 bin/ofm/ 核心运行时...");
  const result = await updateOfmCoreFromGithub({
    binOfmDir: DEFAULT_BIN_OFM_DIR,
    onRestartIfRunning: async () => {
      const pid = readPid();
      if (pid && isPidAlive(pid)) {
        console.log("🔄 检测到 OFM 服务正在运行，正在平滑重启...");
        await stop();
        await start();
        return true;
      }
      return false;
    },
  });
  console.log(
    `✅ [OFM Updater] 更新完成: v${result.sync.version} (core v${result.sync.coreVersion}, commit: ${result.sync.commitSha?.slice(0, 10) || "main"}, 共 ${result.sync.filesCount} 个文件, 代理: ${result.proxy.url || "直连"})`,
  );
}

main().catch((err) => {
  console.error(`❌ [OFM Updater] 失败: ${err.message}`);
  process.exit(1);
});
