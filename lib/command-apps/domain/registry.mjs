const BUILT_IN_APPS = Object.freeze([
  Object.freeze({
    id: "antigravity",
    displayName: "Antigravity",
    description: "Windows 兼容模式启动，避免每次打开终端。",
    type: "executable",
    executableName: "Antigravity.exe",
    defaultArgs: Object.freeze(["--no-sandbox"]),
    supportedPlatforms: Object.freeze(["win32"]),
    discoveryStrategies: Object.freeze([
      "well-known-localappdata",
      "windows-app-paths",
      "path-environment",
      "start-menu-shortcuts",
    ]),
  }),
  Object.freeze({
    id: "shrimp",
    displayName: "Shrimp",
    description: "本地网关服务，支持热重启与服务状态监控。",
    type: "project",
    command: "npm run gateway:restart",
    defaultArgs: Object.freeze(["run", "gateway:restart"]),
    supportedPlatforms: Object.freeze(["win32", "darwin", "linux"]),
    discoveryStrategies: Object.freeze([
      "runtime-ancestor",
      "cwd-ancestor",
    ]),
  }),
  Object.freeze({
    id: "hindsight",
    displayName: "Hindsight",
    description: "本地记忆服务。可配置自定义 LLM 中转，并由网关托管 daemon。",
    type: "cli-daemon",
    executableName: "hindsight-embed",
    command: "hindsight-embed daemon start",
    defaultArgs: Object.freeze(["daemon", "start"]),
    stopArgs: Object.freeze(["daemon", "stop"]),
    defaultPort: 8888,
    healthPath: "/health",
    mcpPath: "/mcp/default/",
    supportedPlatforms: Object.freeze(["win32", "darwin", "linux"]),
    discoveryStrategies: Object.freeze([
      "well-known-local-bin",
      "path-environment",
    ]),
  }),
  Object.freeze({
    id: "langbot",
    displayName: "LangBot",
    description: "多平台 AI 机器人服务。网关只托管进程与入口，应用数据保存在 ~/.langbot。",
    type: "cli-daemon",
    daemonKind: "langbot",
    executableName: "langbot",
    command: "langbot",
    defaultArgs: Object.freeze([]),
    defaultPort: 5300,
    healthPath: "/login",
    appPath: "/",
    mcpPath: "/mcp",
    supportedPlatforms: Object.freeze(["win32", "darwin", "linux"]),
    discoveryStrategies: Object.freeze([
      "well-known-local-bin",
      "path-environment",
    ]),
  }),
]);

const appsById = new Map(BUILT_IN_APPS.map((app) => [app.id, app]));

export function listCommandApps() {
  return BUILT_IN_APPS;
}

export function getCommandApp(id) {
  return appsById.get(String(id || "")) || null;
}
