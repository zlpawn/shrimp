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
]);

const appsById = new Map(BUILT_IN_APPS.map((app) => [app.id, app]));

export function listCommandApps() {
  return BUILT_IN_APPS;
}

export function getCommandApp(id) {
  return appsById.get(String(id || "")) || null;
}
