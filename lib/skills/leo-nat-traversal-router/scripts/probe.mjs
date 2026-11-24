#!/usr/bin/env node
import { getPlatformInfo, getPaths, getRuntimeBaseDir } from "./core/system.mjs";
import { probeFrpc } from "./providers/frp/install.mjs";
import { statusFrpc } from "./providers/frp/supervisor.mjs";
import { getPublicConfig } from "./providers/frp/config.mjs";

export function runProbe({ dataDir = null } = {}) {
  const platform = getPlatformInfo();
  const paths = getPaths(dataDir);
  const runtimeBaseDir = getRuntimeBaseDir(dataDir);
  const frpcProbe = probeFrpc();
  const frpcStatus = statusFrpc({ dataDir });
  const frpcConfig = getPublicConfig(dataDir);

  let dataDirSource = "default";
  if (dataDir) dataDirSource = "cli-argument";
  else if (process.env.LEO_NAT_DATA_DIR) dataDirSource = "env-var (LEO_NAT_DATA_DIR)";

  return {
    timestamp: new Date().toISOString(),
    system: {
      platform: platform.platform,
      arch: platform.arch,
      localBinDir: paths.localBinDir,
      runtimeDir: runtimeBaseDir,
      dataDirSource,
    },
    providers: {
      frp: {
        installed: frpcProbe.installed,
        version: frpcProbe.version,
        binPath: frpcProbe.binPath,
        status: frpcStatus.status,
        pid: frpcStatus.pid,
        mode: frpcStatus.mode,
        configPath: frpcConfig.tomlPath,
        serverAddr: frpcConfig.serverAddr,
        serverPort: frpcConfig.serverPort,
        hasToken: frpcConfig.hasToken,
        proxyCount: frpcConfig.proxies.length,
        proxies: frpcConfig.proxies,
      },
      cloudflare: {
        installed: false,
        status: "planned",
        notes: "Cloudflare Zero Trust tunnel provider will be supported in v2.0",
      },
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("probe.mjs")) {
  let customDir = null;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--data-dir=")) {
      customDir = arg.slice(arg.indexOf("=") + 1);
    }
  }
  const report = runProbe({ dataDir: customDir });
  console.log(JSON.stringify(report, null, 2));
}
