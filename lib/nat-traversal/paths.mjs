import path from "node:path";
import { PROJECT_ROOT, resolveProjectPath } from "../config/project-paths.mjs";

export function resolveNatTraversalPaths({
  configFile = process.env.NAT_TRAVERSAL_CONFIG_FILE || "nat-traversal.config.json",
  secretsFile = process.env.NAT_TRAVERSAL_SECRETS_FILE || "nat-traversal.secrets.json",
  legacyConfigFile = process.env.GATEWAY_CONFIG_FILE || "gateway.config.json",
} = {}) {
  const configPath = resolveProjectPath(configFile);
  const configDir = path.dirname(configPath);
  const dataDir = path.join(configDir, "nat-traversal");
  return {
    projectRoot: PROJECT_ROOT,
    configPath,
    configDir,
    dataDir,
    secretsPath: resolveProjectPath(secretsFile),
    legacyConfigPath: resolveProjectPath(legacyConfigFile),
    generatedFrpcConfigPath: path.join(dataDir, "frpc.toml"),
    pidPath: path.join(dataDir, "frpc.pid"),
    // Fallback for generated configs only. External frpc.toml uses <configDir>/frpc.log.
    logPath: path.join(dataDir, "frpc.log"),
  };
}
