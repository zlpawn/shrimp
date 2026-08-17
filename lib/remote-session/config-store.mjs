import fs from "node:fs";
import path from "node:path";
import {
  defaultRemoteSessionConfig,
  normalizeRemoteSessionConfig,
} from "./domain/config-schema.mjs";

function readJsonFile(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data, mode = 0o644) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(data, null, 2) + "\n";
    fs.writeFileSync(filePath, content, { encoding: "utf8", mode });
    return true;
  } catch (err) {
    console.error("Failed to write JSON to " + filePath + ":", err);
    return false;
  }
}

export function createRemoteSessionConfigStore({
  configPath,
  secretsPath,
  legacyConfigPath,
} = {}) {
  return {
    get() {
      let cfg = readJsonFile(configPath, null);
      if (!cfg && legacyConfigPath) {
        const legacy = readJsonFile(legacyConfigPath, null);
        if (legacy?.remoteSession) {
          cfg = legacy.remoteSession;
        }
      }
      if (!cfg) {
        cfg = defaultRemoteSessionConfig();
      }

      const secrets = readJsonFile(secretsPath, { peers: {} }) || { peers: {} };
      const rawPeers = Array.isArray(cfg.peers) ? cfg.peers : [];

      const mergedPeers = rawPeers.map((p) => {
        const secret = secrets.peers?.[p.id];
        if (!secret) return p;
        return {
          ...p,
          auth: {
            ...p.auth,
            ssh: p.auth?.ssh ? {
              ...p.auth.ssh,
              password: p.auth.ssh.password || secret.password || "",
              privateKeyPath: p.auth.ssh.privateKeyPath || secret.privateKeyPath || "",
            } : undefined,
            gatewayToken: p.auth?.gatewayToken || secret.gatewayToken || "",
          },
        };
      });

      return normalizeRemoteSessionConfig({
        ...cfg,
        peers: mergedPeers,
      });
    },

    save(next) {
      const normalized = normalizeRemoteSessionConfig(next);
      const existingSecrets = readJsonFile(secretsPath, { peers: {} }) || { peers: {} };
      const nextSecrets = { ...(existingSecrets.peers || {}) };

      const cleanPeers = (normalized.peers || []).map((peer) => {
        if (!peer.id) return peer;
        const secret = { ...(nextSecrets[peer.id] || {}) };
        const sshPwd = peer.auth?.ssh?.password;
        const sshKey = peer.auth?.ssh?.privateKeyPath;
        const token = peer.auth?.gatewayToken;

        if (sshPwd && sshPwd !== "******") {
          secret.password = sshPwd;
        }
        if (sshKey && sshKey !== "******") {
          secret.privateKeyPath = sshKey;
        }
        if (token && token !== "******") {
          secret.gatewayToken = token;
        }
        if (Object.keys(secret).length > 0) {
          nextSecrets[peer.id] = secret;
        }

        return {
          ...peer,
          auth: {
            ...peer.auth,
            ssh: peer.auth?.ssh ? {
              ...peer.auth.ssh,
              password: "",
            } : undefined,
            gatewayToken: "",
          },
        };
      });

      if (configPath) {
        writeJsonFile(configPath, {
          peers: cleanPeers,
        });
      }

      if (secretsPath) {
        writeJsonFile(secretsPath, {
          peers: nextSecrets,
        }, 0o600);
      }
    },
  };
}
