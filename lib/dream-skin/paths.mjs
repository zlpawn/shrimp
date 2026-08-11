import path from "node:path";
import { resolveProjectPath } from "../config/project-paths.mjs";

export function resolveDreamSkinPaths({
  configFile = process.env.GATEWAY_CONFIG_FILE || "gateway.config.json",
  projectRoot,
} = {}) {
  const configPath = resolveProjectPath(configFile, projectRoot);
  const configDir = path.dirname(configPath);
  const rootDir = path.join(configDir, "dream-skin");

  return {
    configPath,
    configDir,
    rootDir,
    themesDir: path.join(rootDir, "themes"),
    cacheDir: path.join(rootDir, "cache"),
    statePath: path.join(rootDir, "state.json"),
  };
}
