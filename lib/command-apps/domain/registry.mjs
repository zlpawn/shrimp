const BUILT_IN_APPS = Object.freeze([
  Object.freeze({
    id: "antigravity",
    displayName: "Antigravity",
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
]);

const appsById = new Map(BUILT_IN_APPS.map((app) => [app.id, app]));

export function listCommandApps() {
  return BUILT_IN_APPS;
}

export function getCommandApp(id) {
  return appsById.get(String(id || "")) || null;
}
