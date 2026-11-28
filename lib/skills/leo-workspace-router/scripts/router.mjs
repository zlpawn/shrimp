#!/usr/bin/env node
import path from "node:path";
import { runProbe } from "./probe.mjs";
import { setHost, getMaskedHosts, removeHost } from "./config.mjs";
import * as mutagen from "./engines/mutagen.mjs";
import { pullRemoteGit } from "./modules/remote-git.mjs";
import {
  listTasks,
  startTask,
  stopTask,
  resumeTask,
  removeTask,
  runTaskNow,
  getTaskLogs,
  renderDashboardTable,
  tickScheduler
} from "./modules/scheduler.mjs";

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

        // Optional pre-sync git pull hook
        if (flags.pullGit || flags["pull-git"]) {
          const gitRes = await pullRemoteGit(flags.host, remotePath);
          console.log(`[Pre-sync Git Pull] ${gitRes.summary}`);
        }

        const res = await mutagen.createSession({
          name: flags.name,
          localPath,
          remotePath,
          hostAlias: flags.host,
          syncMode: flags.mode || "two-way-resolved",
          ignores: flags.ignores ? flags.ignores.split(",") : []
        });

        // Optional automatic pull schedule registration
        const autoInterval = flags["pull-interval"] || flags.pullInterval || (flags.autopull ? "5m" : null);
        if (autoInterval) {
          const sessionName = flags.name || path.basename(localPath);
          startTask(sessionName, {
            host: flags.host,
            remotePath,
            interval: autoInterval
          });
          res.autopull = { registered: true, interval: autoInterval };
        }

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
      case "remote-git-pull": {
        const host = flags.host || positional[0];
        const remote = flags.remote || positional[1];
        if (!host || !remote) throw new Error("Both --host and --remote are required");
        const res = await pullRemoteGit(host, remote);
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "autopull": {
        const sub = positional[0] || "list";
        const taskName = positional[1] || flags.name;
        switch (sub) {
          case "list": {
            const tasks = listTasks();
            if (flags.json) {
              console.log(JSON.stringify(tasks, null, 2));
            } else {
              console.log(renderDashboardTable(tasks));
            }
            break;
          }
          case "start": {
            if (!taskName) throw new Error("Task name is required: autopull start <name> --remote=<path> [--interval=5m]");
            const task = startTask(taskName, {
              host: flags.host,
              remotePath: flags.remote,
              interval: flags.interval || flags["pull-interval"] || "5m"
            });
            console.log(JSON.stringify({ success: true, message: `Task '${taskName}' started`, task }, null, 2));
            break;
          }
          case "stop":
          case "pause": {
            if (!taskName) throw new Error("Task name is required: autopull stop <name>");
            const task = stopTask(taskName);
            console.log(JSON.stringify({ success: true, message: `Task '${taskName}' paused`, task }, null, 2));
            break;
          }
          case "resume": {
            if (!taskName) throw new Error("Task name is required: autopull resume <name>");
            const task = resumeTask(taskName);
            console.log(JSON.stringify({ success: true, message: `Task '${taskName}' resumed`, task }, null, 2));
            break;
          }
          case "run": {
            if (!taskName) throw new Error("Task name is required: autopull run <name>");
            const res = await runTaskNow(taskName);
            console.log(JSON.stringify({ success: true, ...res }, null, 2));
            break;
          }
          case "remove": {
            if (!taskName) throw new Error("Task name is required: autopull remove <name>");
            const ok = removeTask(taskName);
            console.log(JSON.stringify({ success: ok, taskName }, null, 2));
            break;
          }
          case "logs": {
            if (!taskName) throw new Error("Task name is required: autopull logs <name>");
            const lines = getTaskLogs(taskName, Number(flags.lines) || 30);
            console.log(lines.join("\n") || `No logs found for task '${taskName}'.`);
            break;
          }
          case "daemon": {
            const intervalSec = Number(flags.interval) || 10;
            if (flags.once) {
              const res = await tickScheduler();
              console.log(JSON.stringify({ success: true, executed: res }, null, 2));
              break;
            }
            console.log(`[Autopull Daemon] Started with tick interval ${intervalSec}s. Press Ctrl+C to exit.`);
            const tick = async () => {
              try {
                const executed = await tickScheduler();
                if (executed.length > 0) {
                  console.log(`[${new Date().toISOString()}] Executed ${executed.length} task(s):`, executed);
                }
              } catch (e) {
                console.error(`[Autopull Daemon Error]`, e.message);
              }
            };
            await tick();
            setInterval(tick, intervalSec * 1000);
            await new Promise(() => {});
            break;
          }
          default:
            throw new Error(`Unknown autopull subcommand: ${sub}. Use list, start, stop, resume, run, logs, remove, or daemon.`);
        }
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
  remote-git-pull [options]       One-off remote git pull (--host, --remote)
  autopull <subcommand>           Remote scheduled pull controller
    autopull list                 Show visual status table of all pull tasks
    autopull start <name> [opts]  Start or update an autopull task (--remote, --host, --interval)
    autopull stop <name>          Pause an autopull task
    autopull resume <name>        Resume an autopull task
    autopull run <name>           Trigger an immediate pull now
    autopull logs <name>          View recent task logs
    autopull remove <name>        Remove an autopull task
    autopull daemon [--once]      Run scheduler daemon loop
`);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: true, message: err.message }, null, 2));
    process.exit(1);
  }
}

main();
