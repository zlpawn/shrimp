import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PRESET_RESOURCE_FILE = path.join(__dirname, '..', '..', 'resources', 'default_services.json');
const USER_SERVICE_MAP_FILE = path.join(os.homedir(), '.shrimp', 'skills', 'live-runner', 'service_map.json');

// 全环境 Apollo ConfigService 地址映射表
export const APOLLO_SERVERS = {
  prod: 'http://prod.config.apollo.ke.com',
  production: 'http://prod.config.apollo.ke.com',
  preview: 'http://prev.config.apollo.ke.com',
  prev: 'http://prev.config.apollo.ke.com',
  pre: 'http://prev.config.apollo.ke.com',
  staging: 'http://prev.config.apollo.ke.com',
  test: 'http://test.config.apollo.ke.com',
  qa: 'http://test.config.apollo.ke.com',
  dev: 'http://dev.config.apollo.ke.com'
};

// 常见业务别名与口语缩写保底映射 (以防外部资源被意外删除或破坏)
export const HARDCODED_FALLBACK_ALIASES = {
  'saas': 'utopia-scs-saas',
  'scs': 'utopia-scs-saas',
  '品控saas': 'utopia-scs-saas',
  '智慧工地saas': 'utopia-scs-saas',
  'recorder': 'utopia-scs-recorder',
  '记录仪': 'utopia-scs-recorder',
  '头戴式记录仪': 'utopia-scs-recorder',
  '品控头戴式记录仪': 'utopia-scs-recorder',
  '临境记录仪': 'utopia-scs-recorder',
  'algo': 'utopia-scs-algo',
  '算法': 'utopia-scs-algo',
  'platform': 'zulin-iot-platform',
  'iot': 'zulin-iot-platform',
  'iot-platform': 'zulin-iot-platform',
  '房源': 'zulin-iot-platform',
  '门锁': 'zulin-iot-platform',
  'warehouse': 'beijia-iot-warehouse',
  'iot-warehouse': 'beijia-iot-warehouse',
  'ecology': 'iot-ecology-platform',
  'erp-core': 'iot-erp-core',
  'erp-finance': 'iot-erp-finance',
  'cloud-plat': 'huiju-iot-cloud-plat',
  'adaptor': 'zulin-iot-device-adaptor',
  'device-adaptor': 'zulin-iot-device-adaptor',
  'cangjie': 'cangjie',
  'memory': 'dial-insight-memory'
};

let cachedCatalog = null;

/**
 * 加载全量微服务注册表 (合并内置预设与用户动态映射)
 */
export function loadServiceCatalog(forceReload = false) {
  if (cachedCatalog && !forceReload) {
    return cachedCatalog;
  }

  const catalog = {};

  // 1. 读取内置预制配置 default_services.json
  if (fs.existsSync(PRESET_RESOURCE_FILE)) {
    try {
      const presetData = JSON.parse(fs.readFileSync(PRESET_RESOURCE_FILE, 'utf8'));
      Object.assign(catalog, presetData);
    } catch {}
  }

  // 2. 读取用户自定义动态映射 service_map.json
  if (fs.existsSync(USER_SERVICE_MAP_FILE)) {
    try {
      const userMap = JSON.parse(fs.readFileSync(USER_SERVICE_MAP_FILE, 'utf8'));
      Object.assign(catalog, userMap);
    } catch {}
  }

  // 3. 保底补齐
  for (const [alias, real] of Object.entries(HARDCODED_FALLBACK_ALIASES)) {
    if (!catalog[alias]) {
      catalog[alias] = { realAppId: real };
    }
  }

  cachedCatalog = catalog;
  return catalog;
}

/**
 * 统一微服务别名解析
 * @param {string} inputApp 输入的应用名、缩写或别名
 * @returns {string} 解析后的标准微服务 realAppId (未命中则原样返回 inputApp)
 */
export function resolveAppId(inputApp) {
  if (!inputApp || typeof inputApp !== 'string') return '';
  const trimmed = inputApp.trim();
  const lower = trimmed.toLowerCase();

  const catalog = loadServiceCatalog();

  if (catalog[trimmed]?.realAppId) return catalog[trimmed].realAppId;
  if (catalog[lower]?.realAppId) return catalog[lower].realAppId;
  if (HARDCODED_FALLBACK_ALIASES[lower]) return HARDCODED_FALLBACK_ALIASES[lower];

  return trimmed;
}

/**
 * 获取微服务元数据 (含端口、测试/生产数据库、ES 索引等)
 * @param {string} inputApp 
 * @returns {object|null}
 */
export function getServiceMeta(inputApp) {
  if (!inputApp) return null;
  const canonicalId = resolveAppId(inputApp);
  const catalog = loadServiceCatalog();

  return catalog[canonicalId] || catalog[inputApp] || null;
}
