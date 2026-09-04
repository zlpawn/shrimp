import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const SHRIMP_LIVE_DIR = path.join(os.homedir(), '.shrimp', 'skills', 'live-inspector');

export function ensureShrimpLiveDir() {
  if (!fs.existsSync(SHRIMP_LIVE_DIR)) {
    fs.mkdirSync(SHRIMP_LIVE_DIR, { recursive: true });
  }
}

/**
 * 通用 Cookie 加载引擎 (支持环境变量 -> 本地缓存 -> Downloads 目录 cookies.txt 自动嗅探)
 */
export function loadCookie({
  envVar = null,
  jsonFileName = 'cookie.json',
  domainFilter = null,
  downloadCandidates = []
} = {}) {
  // 1. 环境变量优先
  if (envVar && process.env[envVar]) {
    return process.env[envVar].trim();
  }

  // 2. 本地持久化文件
  const jsonPath = path.join(SHRIMP_LIVE_DIR, jsonFileName);
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (data.cookie) return data.cookie.trim();
      if (data.token) return data.token.trim();
    } catch {}
  }

  // 3. 自动嗅探 Downloads 与工作目录
  const candidates = [
    ...downloadCandidates.map(name => path.join(process.cwd(), name)),
    path.join(process.cwd(), 'cookies.txt'),
    ...downloadCandidates.map(name => path.join(os.homedir(), 'Downloads', name)),
    path.join(os.homedir(), 'Downloads', 'cookies.txt')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const text = fs.readFileSync(c, 'utf8');
        const lines = text.split('\n');
        const kvs = [];
        for (const line of lines) {
          const parts = line.split('\t');
          if (parts.length >= 7) {
            const domain = parts[0];
            const name = parts[5].trim();
            const val = parts[6].trim();
            if (!domainFilter || domain.includes(domainFilter) || domain.includes('.ke.com')) {
              kvs.push(`${name}=${val}`);
            }
          }
        }
        if (kvs.length > 0) {
          const cookieStr = kvs.join('; ');
          saveCookie({ jsonFileName, cookieStr });
          return cookieStr;
        }
      } catch {}
    }
  }

  return '';
}

/**
 * 通用 Cookie 保存引擎
 */
export function saveCookie({
  jsonFileName = 'cookie.json',
  cookieStr = '',
  extraFields = {}
} = {}) {
  ensureShrimpLiveDir();
  const jsonPath = path.join(SHRIMP_LIVE_DIR, jsonFileName);
  try {
    fs.writeFileSync(jsonPath, JSON.stringify({
      cookie: cookieStr.trim(),
      updated_at: new Date().toISOString(),
      ...extraFields
    }, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ---------------- 专用高层业务凭证接口 ----------------

/** Apollo 测试环境 Portal Cookie */
export function loadApolloTestCookie() {
  return loadCookie({
    envVar: 'APOLLO_TEST_COOKIE',
    jsonFileName: 'test_apollo_cookie.json',
    domainFilter: 'test-apollo',
    downloadCandidates: [
      'cookies-test-apollo.portal.life.ke.com.txt',
      'cookies-test-apollo.txt'
    ]
  });
}

export function saveApolloTestCookie(cookieStr) {
  return saveCookie({
    jsonFileName: 'test_apollo_cookie.json',
    cookieStr
  });
}

/** Paoding Loki 容器日志 Cookie */
export function loadPaodingCookie() {
  return loadCookie({
    envVar: 'PAODING_COOKIE',
    jsonFileName: 'paoding_cookie.json',
    domainFilter: 'paoding',
    downloadCandidates: [
      'cookies-paoding.ke.com.txt',
      'cookies-paoding.txt'
    ]
  });
}

export function savePaodingCookie(cookieStr) {
  return saveCookie({
    jsonFileName: 'paoding_cookie.json',
    cookieStr
  });
}

/** 服务云 MySQL 凭证 Token */
export function loadCloudConsoleToken() {
  const tokenFile = path.join(SHRIMP_LIVE_DIR, 'cloud_token.json');
  if (process.env.CLOUD_CONSOLE_TOKEN) return process.env.CLOUD_CONSOLE_TOKEN.trim();

  if (fs.existsSync(tokenFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      if (data.token) return data.token.trim();
    } catch {}
  }

  const cookieStr = loadCookie({
    jsonFileName: 'cloud_token.json',
    domainFilter: 'cloud.intra.ke.com',
    downloadCandidates: ['cookies-cloud.intra.ke.com.txt']
  });
  if (cookieStr) {
    const match = cookieStr.match(/cloud_console_token_egg=([^;]+)/);
    if (match) return match[1].trim();
  }
  return '';
}

export function saveCloudConsoleToken(token) {
  ensureShrimpLiveDir();
  const tokenFile = path.join(SHRIMP_LIVE_DIR, 'cloud_token.json');
  try {
    fs.writeFileSync(tokenFile, JSON.stringify({
      token: token.trim(),
      updated_at: new Date().toISOString()
    }, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}
