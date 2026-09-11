import fs from "node:fs";
import path from "node:path";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort on platforms that ignore chmod
  }
}

export function createNatTraversalSecretStore({ secretsPath }) {
  const fallback = {
    frpc: { token: "" },
    frpsDashboard: { username: "", password: "" },
    cloudflared: { token: "" },
  };

  function load() {
    const raw = readJson(secretsPath, fallback);
    const envCloudflaredToken = String(process.env.CLOUDFLARE_TUNNEL_TOKEN || "").trim();
    return {
      frpc: {
        token: String(raw?.frpc?.token || ""),
      },
      frpsDashboard: {
        username: String(raw?.frpsDashboard?.username || ""),
        password: String(raw?.frpsDashboard?.password || ""),
      },
      cloudflared: {
        token: envCloudflaredToken || String(raw?.cloudflared?.token || ""),
      },
    };
  }

  function save(partial = {}) {
    const current = load();
    const merged = {
      frpc: {
        token:
          partial?.frpc?.token !== undefined
            ? String(partial.frpc.token || "")
            : current.frpc.token,
      },
      frpsDashboard: {
        username:
          partial?.frpsDashboard?.username !== undefined
            ? String(partial.frpsDashboard.username || "")
            : current.frpsDashboard.username,
        password:
          partial?.frpsDashboard?.password !== undefined
            ? String(partial.frpsDashboard.password || "")
            : current.frpsDashboard.password,
      },
      cloudflared: {
        token:
          partial?.cloudflared?.token !== undefined
            ? String(partial.cloudflared.token || "")
            : current.cloudflared.token,
      },
    };
    writeJson(secretsPath, merged);
    return merged;
  }

  function meta() {
    const secrets = load();
    return {
      frpcTokenConfigured: Boolean(secrets.frpc.token),
      dashboardAuthConfigured: Boolean(
        secrets.frpsDashboard.username || secrets.frpsDashboard.password,
      ),
      cloudflaredTokenConfigured: Boolean(secrets.cloudflared.token),
    };
  }

  return { load, save, meta, secretsPath };
}
