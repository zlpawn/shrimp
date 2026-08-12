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
    marketDir: path.join(rootDir, "market"),
    previewsDir: path.join(rootDir, "market", "previews"),
    stagingDir: path.join(rootDir, ".staging"),
    statePath: path.join(rootDir, "state.json"),
    marketIndexPath: path.join(rootDir, "market", "index.json"),
    installedPath: path.join(rootDir, "market", "installed.json"),
  };
}