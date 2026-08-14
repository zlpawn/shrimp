import path from "node:path";
import { PROJECT_ROOT, resolveProjectPath } from "../config/project-paths.mjs";

export function resolveNatTraversalPaths({
  configFile = process.env.GATEWAY_CONFIG_FILE || "gateway.config.json",
  secretsFile = "",
} = {}) {
  const configPath = resolveProjectPath(configFile);
  const configDir = path.dirname(configPath);
  const dataDir = path.join(configDir, "nat-traversal");
  return {
    projectRoot: PROJECT_ROOT,
    configPath,
    configDir,
    dataDir,
    secretsPath: secretsFile
      ? resolveProjectPath(secretsFile)
      : path.join(configDir, "nat-traversal.secrets.json"),
    generatedFrpcConfigPath: path.join(dataDir, "frpc.toml"),
    pidPath: path.join(dataDir, "frpc.pid"),
    // Fallback for generated configs only. External frpc.toml uses <configDir>/frpc.log.
    logPath: path.join(dataDir, "frpc.log"),
  };
}
