import path from "node:path";
import { resolveProjectPath } from "../config/project-paths.mjs";

export function resolveMcpPaths({
  configFile = process.env.GATEWAY_CONFIG_FILE || "gateway.config.json",
  secretsFile = "",
} = {}) {
  const gatewayConfigPath = resolveProjectPath(configFile);
  const configDir = path.dirname(gatewayConfigPath);
  return {
    gatewayConfigPath,
    configDir,
    configPath: path.join(configDir, "mcp.config.json"),
    secretsPath: secretsFile
      ? resolveProjectPath(secretsFile)
      : path.join(configDir, "mcp.secrets.json"),
  };
}

