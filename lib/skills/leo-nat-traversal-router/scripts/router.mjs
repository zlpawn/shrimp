#!/usr/bin/env node
import { runProbe } from "./probe.mjs";
import { isPortInUse } from "./core/port.mjs";
import { setRuntimeBaseDir, getRuntimeBaseDir } from "./core/system.mjs";
import * as frpInstall from "./providers/frp/install.mjs";
import * as frpConfig from "./providers/frp/config.mjs";
import * as frpSupervisor from "./providers/frp/supervisor.mjs";

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const idx = arg.indexOf("=");
      if (idx !== -1) {
        flags[arg.slice(2, idx)] = arg.slice(idx + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function printHelp() {
  console.log(`
Leo NAT Traversal Router CLI

Usage:
  node scripts/router.mjs <command> [options]

Global Options:
  --data-dir=<path>              Specify custom runtime data directory
                                 (Overrides default and LEO_NAT_DATA_DIR env)

Global Commands:
  probe | status                 Check environment and all provider states
  check-port --port=<port>       Check whether local port is occupied/listening
  set-data-dir --path=<dir>      Persist custom default runtime data directory
  get-data-dir                   Display current effective runtime data directory

FRP Provider (frp):
  frp install [--version=...]    Install frpc to ~/.local/bin/frpc
  frp uninstall                  Remove frpc from ~/.local/bin/frpc
  frp check-update               Check if a newer version of frpc is available on GitHub
  frp update | upgrade           Upgrade frpc to the latest release (gracefully handles restart)
               [--version=...]   [--force]
  frp status                     Check frpc supervisor and process status
  frp start                      Start frpc supervisor in background
  frp stop                       Stop frpc background process
  frp restart                    Restart frpc supervisor
  frp logs [--lines=30]          View recent frpc process logs

FRP Configuration:
  frp config                     View current public config and proxies
  frp set-server --addr=...      Configure frps server host, port & token
                 [--port=7000]
                 [--token=...]
                 [--logLevel=info]
  frp add-proxy --name=...       Add or update a tunnel proxy mapping
                --port=...       (Local listening port)
                [--remote=...]   (Remote exposed port on frps)
                [--type=tcp]     (tcp | udp | http | https)
                [--localIP=127.0.0.1]
  frp remove-proxy --name=...    Remove a proxy by its name
`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const { flags, positional } = parseArgs(rest);

  if (!cmd || cmd === "help" || flags.help) {
    printHelp();
    return;
  }

  const dataDir = flags["data-dir"] || flags.dataDir || null;

  try {
    switch (cmd) {
      case "probe":
      case "status": {
        const report = runProbe({ dataDir });
        console.log(JSON.stringify(report, null, 2));
        break;
      }

      case "get-data-dir": {
        const current = getRuntimeBaseDir(dataDir);
        console.log(JSON.stringify({ dataDir: current }, null, 2));
        break;
      }

      case "set-data-dir": {
        const newPath = flags.path || flags.dir || positional[0];
        if (!newPath) throw new Error("Path is required: --path=<dir>");
        const res = setRuntimeBaseDir(newPath);
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case "check-port": {
        const port = Number(flags.port || positional[0]);
        if (!port) throw new Error("Port is required: --port=<port>");
        const inUse = await isPortInUse(port);
        console.log(JSON.stringify({ port, occupied: inUse }, null, 2));
        break;
      }

      case "frp": {
        const sub = positional[0];
        const subPositional = positional.slice(1);

        switch (sub) {
          case "install": {
            const res = await frpInstall.installFrpc({
              version: flags.version,
              force: Boolean(flags.force),
            });
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "check-update": {
            const res = await frpInstall.checkFrpcUpdate();
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "update":
          case "upgrade": {
            const targetVersion = flags.version || subPositional[0] || null;
            const res = await frpInstall.upgradeFrpc({
              targetVersion,
              force: Boolean(flags.force),
              supervisor: frpSupervisor,
            });
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "uninstall": {
            frpSupervisor.stopFrpc({ dataDir });
            const res = frpInstall.uninstallFrpc();
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "status": {
            const res = frpSupervisor.statusFrpc({ dataDir });
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "start": {
            const res = frpSupervisor.startFrpc({ force: Boolean(flags.force), dataDir });
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "stop": {
            const res = frpSupervisor.stopFrpc({ dataDir });
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "restart": {
            const res = frpSupervisor.restartFrpc({ dataDir });
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "logs": {
            const lines = Number(flags.lines || subPositional[0] || 30);
            const res = frpSupervisor.logsFrpc(lines, { dataDir });
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "config": {
            const res = frpConfig.getPublicConfig(dataDir);
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          case "set-server": {
            const serverAddr = flags.addr || flags.serverAddr || subPositional[0];
            const serverPort = flags.port || flags.serverPort || 7000;
            const token = flags.token;
            const logLevel = flags.logLevel;

            if (!serverAddr) throw new Error("Server address is required: --addr=<host>");
            const res = frpConfig.setServer({ serverAddr, serverPort, token, logLevel, dataDir });
            console.log(JSON.stringify({
              success: true,
              serverAddr: res.config.serverAddr,
              serverPort: res.config.serverPort,
              hasToken: res.hasToken,
              tomlPath: res.tomlPath,
            }, null, 2));
            break;
          }

          case "add-proxy": {
            const name = flags.name || subPositional[0];
            const localPort = flags.port || flags.localPort || subPositional[1];
            const remotePort = flags.remote || flags.remotePort;
            const type = flags.type || "tcp";
            const localIP = flags.localIP || "127.0.0.1";
            const customDomains = flags.domains || flags.customDomains;
            const subdomain = flags.subdomain;

            if (!name) throw new Error("Proxy name is required: --name=<name>");
            if (!localPort) throw new Error("Local port is required: --port=<port>");

            const res = frpConfig.addProxy({
              name,
              type,
              localIP,
              localPort,
              remotePort,
              customDomains,
              subdomain,
              dataDir,
            });
            console.log(JSON.stringify({
              success: true,
              proxy: res.config.proxies.find((p) => p.name === name),
              totalProxies: res.config.proxies.length,
              tomlPath: res.tomlPath,
            }, null, 2));
            break;
          }

          case "remove-proxy": {
            const name = flags.name || subPositional[0];
            if (!name) throw new Error("Proxy name is required: --name=<name>");
            const res = frpConfig.removeProxy(name, dataDir);
            console.log(JSON.stringify(res, null, 2));
            break;
          }

          default:
            console.error(`Unknown frp subcommand: '${sub}'. Run with --help for usage.`);
            process.exit(1);
        }
        break;
      }

      default:
        console.error(`Unknown command: '${cmd}'. Run with --help for usage.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

main();
