import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

function defaultRunner(command) {
  return (args, options) => execFileP(command, args, {
    ...options,
    windowsHide: true,
    timeout: 15 * 60 * 1000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function ensureAntigravitySessionBridge(id) {
  try {
    const desktopDir = path.join(os.homedir(), ".gemini", "antigravity");
    const cliDir = path.join(os.homedir(), ".gemini", "antigravity-cli");

    const desktopDb = path.join(desktopDir, "conversations", `${id}.db`);
    const cliDb = path.join(cliDir, "conversations", `${id}.db`);
    if (fs.existsSync(desktopDb)) {
      fs.mkdirSync(path.dirname(cliDb), { recursive: true });
      fs.copyFileSync(desktopDb, cliDb);
      for (const suffix of ["-wal", "-shm"]) {
        const dSub = desktopDb + suffix;
        const cSub = cliDb + suffix;
        if (fs.existsSync(dSub)) fs.copyFileSync(dSub, cSub);
      }
    }

    const desktopBrain = path.join(desktopDir, "brain", id);
    const cliBrain = path.join(cliDir, "brain", id);
    if (fs.existsSync(desktopBrain) && !fs.existsSync(cliBrain)) {
      fs.cpSync(desktopBrain, cliBrain, { recursive: true });
    }
  } catch {}
}

function syncAntigravitySessionBack(id) {
  try {
    const desktopDir = path.join(os.homedir(), ".gemini", "antigravity");
    const cliDir = path.join(os.homedir(), ".gemini", "antigravity-cli");

    const desktopDb = path.join(desktopDir, "conversations", `${id}.db`);
    const cliDb = path.join(cliDir, "conversations", `${id}.db`);
    if (fs.existsSync(cliDb) && fs.existsSync(path.dirname(desktopDb))) {
      fs.copyFileSync(cliDb, desktopDb);
      for (const suffix of ["-wal", "-shm"]) {
        const dSub = desktopDb + suffix;
        const cSub = cliDb + suffix;
        if (fs.existsSync(cSub)) fs.copyFileSync(cSub, dSub);
      }
    }

    const cliBrain = path.join(cliDir, "brain", id);
    const desktopBrain = path.join(desktopDir, "brain", id);
    if (fs.existsSync(cliBrain) && fs.existsSync(path.dirname(desktopBrain))) {
      fs.cpSync(cliBrain, desktopBrain, { recursive: true, force: true });
    }
  } catch {}
}

function makeDispatcher({ client, command, buildArgs, beforeDispatch, afterDispatch, runners }) {
  const run = runners.get(client) || defaultRunner(command);
  return {
    client,
    canDispatch(session) {
      return session?.client === client && Boolean(session?.dispatchTarget);
    },
    async dispatch(session, message) {
      if (!session?.dispatchTarget) throw new Error("Session has no dispatch target");
      if (beforeDispatch) await beforeDispatch(session.dispatchTarget);
      const args = buildArgs(session.dispatchTarget, message);
      const options = session.workspacePath ? { cwd: session.workspacePath } : {};
      const { stdout, stderr } = await run(args, options);
      if (afterDispatch) await afterDispatch(session.dispatchTarget);
      return {
        command: command + " " + args.slice(0, -1).join(" ") + " <message>",
        exitCode: 0,
        stdout: String(stdout || "").slice(0, 4000),
        stderr: String(stderr || "").slice(0, 4000),
      };
    },
  };
}

export function createCliDispatchers({
  runners = new Map(),
  commands = new Map([
    ["codex", "codex"],
    ["claude", "claude"],
    ["antigravity", "agy"],
  ]),
} = {}) {
  return [
    makeDispatcher({
      client: "claude",
      command: commands.get("claude"),
      buildArgs: (id, message) => ["--resume", id, "--print", message],
      runners,
    }),
    makeDispatcher({
      client: "antigravity",
      command: commands.get("antigravity"),
      buildArgs: (id, message) => ["--conversation", id, "--print", message],
      beforeDispatch: id => ensureAntigravitySessionBridge(id),
      afterDispatch: id => syncAntigravitySessionBack(id),
      runners,
    }),
    makeDispatcher({
      client: "codex",
      command: commands.get("codex"),
      buildArgs: (id, message) => ["exec", "resume", id, message],
      runners,
    }),
  ];
}
