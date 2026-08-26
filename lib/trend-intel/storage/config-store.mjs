import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CONFIG = {
  scheduler: {
    enabled: true,
    interval_minutes: 30,
    daily_brief_times: ["08:30", "18:00"]
  },
  model_route: {
    client: "codex",
    endpoint_index: 0,
    model: ""
  },
  proxy: {
    mode: "inherit", // 'inherit' | 'direct' | 'custom'
    custom_url: ""
  },
  platforms: {
    weibo: true,
    zhihu: true,
    baidu: true,
    bilibili: true,
    douyin: true,
    toutiao: true,
    github: true,
    "36kr": true,
    wallstreetcn: true
  },
  focus_topics: [
    {
      id: "topic_ai",
      name: "人工智能与前沿科技",
      icon: "🤖",
      enabled: true,
      keywords: ["AI", "大模型", "DeepSeek", "算力", "Agent", "OpenAI", "Claude", "英伟达", "具身智能"],
      rss_sources: ["https://36kr.com/feed"]
    },
    {
      id: "topic_cars",
      name: "智能汽车与出行",
      icon: "🚗",
      enabled: true,
      keywords: ["智驾", "固态电池", "小米汽车", "特斯拉", "比亚迪", "华为车", "新能源"],
      rss_sources: []
    }
  ]
};

export function createTrendIntelConfigStore(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const configFile = path.join(dataDir, "trend-intel.config.json");

  function get() {
    if (!fs.existsSync(configFile)) {
      fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    try {
      const raw = fs.readFileSync(configFile, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        scheduler: { ...DEFAULT_CONFIG.scheduler, ...(parsed?.scheduler || {}) },
        model_route: { ...DEFAULT_CONFIG.model_route, ...(parsed?.model_route || {}) },
        proxy: { ...DEFAULT_CONFIG.proxy, ...(parsed?.proxy || {}) },
        platforms: { ...DEFAULT_CONFIG.platforms, ...(parsed?.platforms || {}) },
        focus_topics: Array.isArray(parsed?.focus_topics) ? parsed.focus_topics : DEFAULT_CONFIG.focus_topics
      };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  function update(patch) {
    const current = get();
    const next = {
      ...current,
      ...patch,
      scheduler: patch.scheduler ? { ...current.scheduler, ...patch.scheduler } : current.scheduler,
      model_route: patch.model_route ? { ...current.model_route, ...patch.model_route } : current.model_route,
      proxy: patch.proxy ? { ...current.proxy, ...patch.proxy } : current.proxy,
      platforms: patch.platforms ? { ...current.platforms, ...patch.platforms } : current.platforms,
      focus_topics: Array.isArray(patch.focus_topics) ? patch.focus_topics : current.focus_topics
    };
    fs.writeFileSync(configFile, JSON.stringify(next, null, 2), "utf-8");
    return next;
  }

  return { get, update, configFile };
}
