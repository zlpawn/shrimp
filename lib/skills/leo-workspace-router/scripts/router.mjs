#!/usr/bin/env node
import { runProbe } from "./probe.mjs";
import { setHost, getMaskedHosts, removeHost } from "./config.mjs";
import * as mutagen from "./engines/mutagen.mjs";

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

async function main() {
  const [,, cmd, ...rest] = process.argv;
  const { flags, positional } = parseArgs(rest);

  try {
    switch (cmd) {
      case "probe": {
        const report = await runProbe();
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      case "install": {
        const engine = positional[0] || flags.engine || "mutagen";
        if (engine === "mutagen") {
          const res = await mutagen.install();
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.error(`Unsupported engine: ${engine}`);
          process.exit(1);
        }
        break;
      }
      case "check-update": {
        const engine = positional[0] || flags.engine || "mutagen";
        if (engine === "mutagen") {
          const res = await mutagen.checkUpdate();
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.error(`Unsupported engine: ${engine}`);
          process.exit(1);
        }
        break;
      }
      case "upgrade":
      case "update": {
        const engine = positional[0] || flags.engine || "mutagen";
        if (engine === "mutagen") {
          const res = await mutagen.upgrade({ force: Boolean(flags.force) });
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.error(`Unsupported engine: ${engine}`);
          process.exit(1);
        }
        break;
      }
      case "uninstall": {
        const engine = positional[0] || flags.engine || "mutagen";
        if (engine === "mutagen") {
          const res = await mutagen.uninstall();
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.error(`Unsupported engine: ${engine}`);
          process.exit(1);
        }
        break;
      }
      case "add-host": {
        const alias = positional[0] || flags.alias;
        if (!alias) throw new Error("Host alias is required");
        const saved = setHost(alias, {
          host: flags.host,
          port: flags.port || 22,
          username: flags.user || flags.username,
          password: flags.password,
          identityFile: flags.key || flags.identityFile,
          description: flags.desc || flags.description
        });
        console.log(JSON.stringify({ success: true, host: saved }, null, 2));
        break;
      }
      case "list-hosts": {
        const res = getMaskedHosts();
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "remove-host": {
        const alias = positional[0] || flags.alias;
        const ok = removeHost(alias);
        console.log(JSON.stringify({ success: ok, alias }, null, 2));
        break;
      }
      case "create": {
        const localPath = flags.local;
        const remotePath = flags.remote;
        if (!localPath || !remotePath) {
          throw new Error("Both --local and --remote paths are required");
        }
        const res = await mutagen.createSession({
          name: flags.name,
          localPath,
          remotePath,
          hostAlias: flags.host,
          syncMode: flags.mode || "two-way-resolved",
          ignores: flags.ignores ? flags.ignores.split(",") : []
        });
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "list": {
        const target = positional[0] || flags.name || "";
        const res = await mutagen.listSessions(target);
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "pause": {
        const name = positional[0] || flags.name;
        if (!name) throw new Error("Session name is required");
        const res = await mutagen.pauseSession(name);
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "resume": {
        const name = positional[0] || flags.name;
        if (!name) throw new Error("Session name is required");
        const res = await mutagen.resumeSession(name, flags.host);
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "flush": {
        const name = positional[0] || flags.name;
        if (!name) throw new Error("Session name is required");
        const res = await mutagen.flushSession(name, flags.host);
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "terminate": {
        const name = positional[0] || flags.name;
        if (!name) throw new Error("Session name is required (use --all to terminate all)");
        const res = await mutagen.terminateSession(flags.all ? "--all" : name);
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      default:
        console.log(`leo-workspace-router CLI Dispatcher
Commands:
  probe                           Probe all engines and host readiness
  check-update [engine]           Check for newer versions of underlying CLI
  upgrade [engine] [--force]      Upgrade underlying CLI to latest release
  install [engine]                Install underlying CLI (default: mutagen)
  uninstall [engine]              Safely stop daemon & uninstall CLI
  add-host <alias> [options]      Add/update host credentials
  list-hosts                      List configured hosts (passwords masked)
  remove-host <alias>             Remove a host
  create [options]                Create sync session (--local, --remote, --host)
  list [name]                     List sync sessions and health
  pause <name>                    Pause a sync session
  resume <name>                   Resume a sync session
  flush <name>                    Force sync flush
  terminate <name|--all>          Terminate sync session(s)
`);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: true, message: err.message }, null, 2));
    process.exit(1);
  }
}

main();
