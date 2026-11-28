#!/usr/bin/env node
import { exec, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getHost, getBinDir, getEngineDataDir } from "../config.mjs";

const execAsync = promisify(exec);
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ASKPASS_SCRIPT = process.platform === "win32"
  ? path.resolve(SCRIPT_DIR, "..", "askpass.mjs")
  : path.resolve(SCRIPT_DIR, "..", "askpass.sh");

/**
 * Build child process environment variables with SSH_ASKPASS and isolated paths
 */
export function buildSshEnv(host) {
  const binDir = getBinDir();
  const nodeBinDir = path.dirname(process.execPath);
  const pathSep = process.platform === "win32" ? ";" : ":";

  const env = {
    ...process.env,
    PATH: `${binDir}${pathSep}${nodeBinDir}${pathSep}${process.env.PATH || ""}`
  };

  if (host && host.password) {
    env.DISPLAY = process.env.DISPLAY || ":0";
    env.SSH_ASKPASS_REQUIRE = "force";
    env.SSH_ASKPASS = ASKPASS_SCRIPT;
    env.LEO_NODE_BIN = process.execPath;
    env.LEO_SSH_PASSWORD = host.password;
    env.LEO_SSH_TARGET_ALIAS = host.alias || "";
  }

  return env;
}

/**
 * Execute command inside a PTY via Python so SSH password prompts are handled automatically
 */
export function runWithPty(fullCmd, env, timeoutMs = 60000) {
  const pyCode = `
import os, pty, select, subprocess, sys, time

cmd = sys.argv[1]
pwd = os.environ.get("LEO_SSH_PASSWORD", "")
timeout = float(sys.argv[2])
master, slave = pty.openpty()
proc = subprocess.Popen(["/bin/sh", "-c", cmd], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
os.close(slave)

buf = b""
out = bytearray()
deadline = time.time() + timeout
sent_count = 0

while True:
    remaining = deadline - time.time()
    if remaining <= 0:
        proc.kill()
        sys.stderr.write("Command timed out\\n")
        sys.exit(124)
    r, _, _ = select.select([master], [], [], min(0.5, remaining))
    if master in r:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            break
        if not chunk:
            break
        out.extend(chunk)
        buf = (buf + chunk)[-512:]
        low = buf.lower()
        if b"password:" in low and sent_count < 5:
            os.write(master, (pwd + "\\n").encode("utf-8"))
            sent_count += 1
            buf = b""
        elif b"yes/no" in low:
            os.write(master, b"yes\\n")
            buf = b""
    elif proc.poll() is not None:
        while True:
            try:
                chunk = os.read(master, 4096)
                if not chunk:
                    break
                out.extend(chunk)
            except OSError:
                break
        break

os.close(master)
rc = proc.wait()
sys.stdout.buffer.write(out)
sys.exit(rc)
`;

  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", pyCode, fullCmd, String(timeoutMs / 1000)], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString("utf-8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`Remote command failed (exit code ${code}): ${stdout || stderr}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

/**
 * Universal remote command executor using saved host credentials
 * @param {string|object} hostOrAlias Host alias string or host config object
 * @param {string} remoteCmd Command string to execute on the remote machine
 * @param {object} options Optional settings: { timeoutMs: number }
 */
export async function runRemoteCommand(hostOrAlias, remoteCmd, options = {}) {
  const host = typeof hostOrAlias === "string" ? getHost(hostOrAlias) : hostOrAlias;
  if (!host) {
    throw new Error(`Host '${hostOrAlias}' not found in configuration.`);
  }

  const port = host.port || 22;
  const user = host.username;
  const ip = host.host;
  const timeoutMs = options.timeoutMs || 60000;

  let keyArg = "";
  if (host.identityFile && fs.existsSync(host.identityFile)) {
    keyArg = `-i "${host.identityFile}" `;
  }

  // Base64 encode the remote command to eliminate any shell quoting/newline escaping issues
  const b64 = Buffer.from(remoteCmd, "utf-8").toString("base64");
  const remoteBootstrap = `echo '${b64}' | (base64 -d 2>/dev/null || base64 -D) | /bin/sh`;

  // Base SSH command
  const sshCmd = `ssh -p ${port} ${keyArg}-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR ${user}@${ip} "${remoteBootstrap}"`;
  const env = buildSshEnv(host);

  if (host.password && process.platform !== "win32") {
    return await runWithPty(sshCmd, env, timeoutMs);
  }

  return await execAsync(sshCmd, { env, timeout: timeoutMs });
}
