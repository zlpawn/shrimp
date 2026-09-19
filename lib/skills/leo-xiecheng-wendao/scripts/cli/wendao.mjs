import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WENDAO_API_URL =
  "https://externalcallback.ctrip.com/skills/api/crew/qclaw/searchInfo";

const TOKEN_PATTERN = /^[0-9a-f]{32}$/i;
const SHORT_RESULT_LIMIT = 25;

export function resolveSecretPaths({ homeDir = os.homedir(), env = process.env } = {}) {
  const override = String(env.SHRIMP_SECRETS_DIR || "").trim();
  const root = override
    ? path.join(expandHome(override, homeDir), "wendao")
    : path.join(homeDir, ".shrimp", "secrets", "wendao");
  return { root, token: path.join(root, "token") };
}

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

export function normalizeToken(value) {
  const token = String(value || "").trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid Wendao token: expected a 32-character hexadecimal token.");
  }
  return token.toLowerCase();
}

export function readToken({ homeDir = os.homedir(), env = process.env } = {}) {
  const injected = String(env.WENDAO_API_KEY || "").trim();
  if (injected) return normalizeToken(injected);

  const { token: tokenPath } = resolveSecretPaths({ homeDir, env });
  try {
    return normalizeToken(fs.readFileSync(tokenPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw new Error("Unable to read the Wendao token file. Check its directory permissions.");
  }
}

export function saveToken(
  value,
  { homeDir = os.homedir(), env = process.env } = {},
) {
  const token = normalizeToken(value);
  const { root, token: tokenPath } = resolveSecretPaths({ homeDir, env });
  const parent = path.dirname(root);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try { fs.chmodSync(parent, 0o700); } catch {}
    fs.chmodSync(root, 0o700);
  }
  fs.writeFileSync(tokenPath, token + "\n", { mode: 0o600, encoding: "utf8" });
  if (process.platform !== "win32") {
    fs.chmodSync(tokenPath, 0o600);
  }
  return tokenPath;
}

export async function queryWendao(
  query,
  {
    token,
    fetchImpl = fetch,
    delay = defaultDelay,
    attempts = 3,
    backoffs = [4000, 8000],
  } = {},
) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) throw new Error("Missing Wendao query.");

  const normalizedToken = normalizeToken(token);
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let payload;
    try {
      const response = await fetchImpl(WENDAO_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: { token: normalizedToken, query: normalizedQuery },
        }),
      });

      if (!response.ok) {
        throw new Error(`Wendao API returned HTTP ${response.status}.`);
      }
      payload = await response.json();
    } catch (error) {
      lastError = new Error(error?.message?.includes("Wendao API returned HTTP")
        ? error.message
        : "Wendao request failed before a response was received.");
      if (attempt === maxAttempts) break;
      await delay(backoffs[attempt - 1] ?? backoffs.at(-1) ?? 0);
      continue;
    }

    if (payload?.error) {
      throw new Error("Wendao API returned a business error. The raw response is omitted.");
    }

    const result = normalizeResult(payload.result);
    if (result.trim().length >= SHORT_RESULT_LIMIT) return result;

    lastError = new Error("Wendao returned only a short acknowledgement after retries.");
    if (attempt === maxAttempts) break;
    await delay(backoffs[attempt - 1] ?? backoffs.at(-1) ?? 0);
  }

  throw lastError || new Error("Wendao query failed.");
}

function normalizeResult(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.content === "string") {
    return value.content;
  }
  return "";
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
