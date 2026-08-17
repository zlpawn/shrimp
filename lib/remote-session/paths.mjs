import path from "node:path";
import { PROJECT_ROOT, resolveProjectPath } from "../config/project-paths.mjs";

export function resolveRemoteSessionPaths({
  configFile = process.env.REMOTE_SESSION_CONFIG_FILE || "remote-session.config.json",
  secretsFile = process.env.REMOTE_SESSION_SECRETS_FILE || "remote-session.secrets.json",
  legacyConfigFile = process.env.GATEWAY_CONFIG_FILE || "gateway.config.json",
} = {}) {
  const configPath = resolveProjectPath(configFile);
  const secretsPath = resolveProjectPath(secretsFile);
  const configDir = path.dirname(configPath);
  const dataDir = path.join(configDir, "remote-session");
  return {
    projectRoot: PROJECT_ROOT,
    configPath,
    secretsPath,
    legacyConfigPath: resolveProjectPath(legacyConfigFile),
    configDir,
    dataDir,
    eventLogDir: path.join(dataDir, "events"),
  };
}
