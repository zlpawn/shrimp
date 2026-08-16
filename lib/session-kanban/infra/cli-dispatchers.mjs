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

function makeDispatcher({ client, command, buildArgs, runners }) {
  const run = runners.get(client) || defaultRunner(command);
  return {
    client,
    canDispatch(session) {
      return session?.client === client && Boolean(session?.dispatchTarget);
    },
    async dispatch(session, message) {
      if (!session?.dispatchTarget) throw new Error("Session has no dispatch target");
      const args = buildArgs(session.dispatchTarget, message);
      const options = session.workspacePath ? { cwd: session.workspacePath } : {};
      const { stdout, stderr } = await run(args, options);
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
