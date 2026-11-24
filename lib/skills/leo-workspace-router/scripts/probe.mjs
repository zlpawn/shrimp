#!/usr/bin/env node
import os from "node:os";
import { probe as probeMutagen } from "./engines/mutagen.mjs";
import { getMaskedHosts, loadConfig, getBinDir, getEngineDataDir } from "./config.mjs";

export async function runProbe() {
  const mutagenStatus = await probeMutagen();
  const maskedConfig = getMaskedHosts();
  const cfg = loadConfig();

  const report = {
    platform: process.platform,
    arch: process.arch,
    homeDir: os.homedir(),
    binDir: getBinDir(),
    dataDirRoot: maskedConfig.dataDir,
    activeEngine: "mutagen",
    engines: {
      mutagen: mutagenStatus,
      cloudflare: {
        engine: "cloudflare",
        planned: true,
        active: false,
        dataDir: getEngineDataDir("cloudflare")
      },
      rsync: {
        engine: "rsync",
        planned: true,
        active: false,
        dataDir: getEngineDataDir("rsync")
      }
    },
    hostsConfigured: Object.keys(maskedConfig.hosts || {}).length,
    defaultHost: maskedConfig.default_host,
    hosts: maskedConfig.hosts,
    recordedSessions: Object.keys(cfg.sessions || {}).length
  };

  return report;
}

if (process.argv[1] && process.argv[1].endsWith("probe.mjs")) {
  runProbe().then((res) => {
    console.log(JSON.stringify(res, null, 2));
  }).catch((err) => {
    console.error("Probe failed:", err);
    process.exit(1);
  });
}
