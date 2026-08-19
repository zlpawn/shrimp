import net from "node:net";
import { spawn } from "node:child_process";
import { McpManagementError } from "../domain/errors.mjs";

export function findFreePort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(preferredPort, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

export function createInspectorManager({
  cwd = process.cwd(),
  logger = console,
  spawnImpl = spawn,
  findPortImpl = findFreePort,
} = {}) {
  // Map of serverName -> { process, port, pid, startedAt, serverName, ready, exited, exitCode, logs, errorLogs }
  const activeInstances = new Map();

  async function start(serverName, server, secrets = {}) {
    const name = String(serverName || "").trim();
    if (!name) {
      throw new McpManagementError("invalid_request", "serverName is required");
    }

    // If already running and ready, return existing status
    if (activeInstances.has(name)) {
      const existing = activeInstances.get(name);
      if (existing.ready && existing.port) {
        return {
          serverName: name,
          running: true,
          port: existing.port,
          url: `/v1/mcp-management/inspector-proxy/${encodeURIComponent(name)}/`,
          startedAt: existing.startedAt,
        };
      }
    }

    const clientPort = await findPortImpl();
    const serverPort = await findPortImpl();

    const isWin = process.platform === "win32";
    const secretEnv = (secrets.servers && secrets.servers[name]?.env) || {};
    const serverEnv = server?.env || {};
    const combinedEnv = {
      ...process.env,
      ...serverEnv,
      ...secretEnv,
      HOST: "127.0.0.1",
      CLIENT_PORT: String(clientPort),
      PORT: String(serverPort),
      MCP_AUTO_OPEN_ENABLED: "false",
      DANGEROUSLY_OMIT_AUTH: "true",
      ALLOWED_ORIGINS: `http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:${clientPort},http://localhost:${clientPort}`,
      npm_config_allow_scripts: "",
      BROWSER: "none",
    };

    let inspectorTargetArgs = [];
    if (server?.transport === "sse" || server?.url) {
      inspectorTargetArgs = ["--transport", "sse", "--server-url", server.url];
    } else {
      const cmd = server?.command || "node";
      const args = server?.args || [];
      inspectorTargetArgs = [cmd, ...args];
    }

    let executable;
    let spawnArgs;
    if (isWin) {
      executable = "cmd.exe";
      spawnArgs = ["/c", "npx", "-y", "@modelcontextprotocol/inspector", ...inspectorTargetArgs];
    } else {
      executable = "npx";
      spawnArgs = ["-y", "@modelcontextprotocol/inspector", ...inspectorTargetArgs];
    }

    logger.log(`[mcp-inspector] Starting inspector for "${name}" on internal web port ${clientPort}...`);

    let child;
    try {
      child = spawnImpl(executable, spawnArgs, {
        cwd,
        env: combinedEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      throw new McpManagementError("storage_error", `Failed to spawn inspector for ${name}: ${err.message}`);
    }

    const instance = {
      serverName: name,
      port: clientPort,
      serverPort,
      process: child,
      pid: child.pid,
      startedAt: Date.now(),
      ready: false,
      exited: false,
      exitCode: null,
      logs: "",
      errorLogs: "",
    };

    activeInstances.set(name, instance);

    const onData = (data) => {
      const text = data.toString();
      instance.logs += text;
      if (text.includes("is up and running at") || text.includes(String(clientPort)) || text.includes("Inspector")) {
        instance.ready = true;
      }
    };

    const onErrorData = (data) => {
      const text = data.toString();
      instance.errorLogs += text;
      if (text.includes("is up and running at") || text.includes(String(clientPort)) || text.includes("Inspector")) {
        instance.ready = true;
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onErrorData);

    child.on("error", (err) => {
      logger.error(`[mcp-inspector] Error for "${name}":`, err.message);
      instance.exited = true;
      instance.errorLogs += `\n${err.message}`;
      activeInstances.delete(name);
    });

    child.on("exit", (code, signal) => {
      logger.log(`[mcp-inspector] Inspector for "${name}" exited (code=${code}, signal=${signal})`);
      instance.exited = true;
      instance.exitCode = code;
      activeInstances.delete(name);
    });

    // Wait until web server responds or process exits (up to 12s)
    await new Promise((resolve, reject) => {
      let elapsed = 0;
      const interval = 200;
      const timer = setInterval(async () => {
        elapsed += interval;

        if (instance.exited) {
          clearInterval(timer);
          const errDetail = instance.errorLogs.trim() || instance.logs.trim() || `exit code ${instance.exitCode}`;
          reject(new McpManagementError("storage_error", `Inspector 启动异常已退出: ${errDetail}`));
          return;
        }

        // Try probing clientPort via HTTP
        try {
          const probe = await fetch(`http://127.0.0.1:${clientPort}/`, { signal: AbortSignal.timeout(500) });
          if (probe.status < 500) {
            instance.ready = true;
            clearInterval(timer);
            resolve();
            return;
          }
        } catch {
          // not ready yet
        }

        if (instance.ready && elapsed >= 1000) {
          clearInterval(timer);
          resolve();
          return;
        }

        if (elapsed >= 12000) {
          clearInterval(timer);
          if (instance.ready) {
            resolve();
          } else {
            reject(new McpManagementError("storage_error", `Inspector 启动超时 (12s): 端口 ${clientPort} 未能成功响应。\n输出日志: ${instance.logs || instance.errorLogs}`));
          }
        }
      }, interval);
    });

    return {
      serverName: name,
      running: true,
      port: clientPort,
      url: `/v1/mcp-management/inspector-proxy/${encodeURIComponent(name)}/`,
      startedAt: instance.startedAt,
    };
  }

  async function stop(serverName) {
    const name = String(serverName || "").trim();
    const instance = activeInstances.get(name);
    if (!instance) {
      return { serverName: name, running: false };
    }

    try {
      if (process.platform === "win32" && instance.pid) {
        spawn("taskkill", ["/pid", String(instance.pid), "/T", "/F"], { windowsHide: true });
      } else if (instance.process?.kill) {
        instance.process.kill("SIGTERM");
      }
    } catch {
      try { instance.process?.kill?.("SIGKILL"); } catch {}
    }

    activeInstances.delete(name);
    logger.log(`[mcp-inspector] Stopped inspector for "${name}"`);
    return { serverName: name, running: false };
  }

  function status(serverName) {
    const name = String(serverName || "").trim();
    const instance = activeInstances.get(name);
    if (!instance || !instance.port) {
      return { serverName: name, running: false, port: null, url: null };
    }
    return {
      serverName: name,
      running: true,
      port: instance.port,
      url: `/v1/mcp-management/inspector-proxy/${encodeURIComponent(name)}/`,
      startedAt: instance.startedAt,
    };
  }

  function getInstance(serverName) {
    const name = String(serverName || "").trim();
    return activeInstances.get(name) || null;
  }

  function listRunning() {
    const list = [];
    for (const [name, inst] of activeInstances.entries()) {
      if (inst.ready && inst.port) {
        list.push({
          serverName: name,
          port: inst.port,
          url: `/v1/mcp-management/inspector-proxy/${encodeURIComponent(name)}/`,
          startedAt: inst.startedAt,
        });
      }
    }
    return list;
  }

  function cleanupAll() {
    for (const name of activeInstances.keys()) {
      stop(name);
    }
  }

  return {
    start,
    stop,
    status,
    getInstance,
    listRunning,
    cleanupAll,
  };
}
