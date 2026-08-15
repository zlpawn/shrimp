import path from "node:path";
import { PROJECT_ROOT, resolveProjectPath } from "../config/project-paths.mjs";

export function resolveRemoteSessionPaths({
  configFile = process.env.GATEWAY_CONFIG_FILE || "gateway.config.json",
} = {}) {
  const configPath = resolveProjectPath(configFile);
  const configDir = path.dirname(configPath);
  const dataDir = path.join(configDir, "remote-session");
  return {
    projectRoot: PROJECT_ROOT,
    configPath,
    configDir,
    dataDir,
    eventLogDir: path.join(dataDir, "events"),
  };
}
