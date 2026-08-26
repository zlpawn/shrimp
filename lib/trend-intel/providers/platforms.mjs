/**
 * Platform registry and metadata for Trend Intelligence.
 */

export const PLATFORMS = {
  weibo: {
    id: "weibo",
    name: "微博热搜",
    icon: "🔥",
    category: "general",
    type: "hotlist",
    url: "https://weibo.com"
  },
  zhihu: {
    id: "zhihu",
    name: "知乎热榜",
    icon: "💡",
    category: "general",
    type: "hotlist",
    url: "https://www.zhihu.com/hot"
  },
  baidu: {
    id: "baidu",
    name: "百度热搜",
    icon: "🔍",
    category: "general",
    type: "hotlist",
    url: "https://top.baidu.com"
  },
  bilibili: {
    id: "bilibili",
    name: "B站热搜",
    icon: "📺",
    category: "entertainment",
    type: "hotlist",
    url: "https://www.bilibili.com"
  },
  douyin: {
    id: "douyin",
    name: "抖音热搜",
    icon: "🎵",
    category: "entertainment",
    type: "hotlist",
    url: "https://www.douyin.com"
  },
  toutiao: {
    id: "toutiao",
    name: "今日头条",
    icon: "📰",
    category: "news",
    type: "hotlist",
    url: "https://www.toutiao.com"
  },
  github: {
    id: "github",
    name: "GitHub Trending",
    icon: "🐙",
    category: "tech",
    type: "hotlist",
    url: "https://github.com/trending"
  },
  "36kr": {
    id: "36kr",
    name: "36氪",
    icon: "⚡",
    category: "tech",
    type: "hotlist",
    url: "https://36kr.com"
  },
  wallstreetcn: {
    id: "wallstreetcn",
    name: "华尔街见闻",
    icon: "📈",
    category: "finance",
    type: "hotlist",
    url: "https://wallstreetcn.com"
  },
  tieba: {
    id: "tieba",
    name: "百度贴吧",
    icon: "💬",
    category: "community",
    type: "hotlist",
    url: "https://tieba.baidu.com"
  },
  v2ex: {
    id: "v2ex",
    name: "V2EX",
    icon: "💻",
    category: "tech",
    type: "hotlist",
    url: "https://v2ex.com"
  },
  sspai: {
    id: "sspai",
    name: "少数派",
    icon: "📱",
    category: "tech",
    type: "hotlist",
    url: "https://sspai.com"
  },
  thepaper: {
    id: "thepaper",
    name: "澎湃新闻",
    icon: "🗞️",
    category: "news",
    type: "hotlist",
    url: "https://www.thepaper.cn"
  },
  cls: {
    id: "cls",
    name: "财联社",
    icon: "💹",
    category: "finance",
    type: "hotlist",
    url: "https://www.cls.cn"
  }
};

/**
 * Retrieve metadata for a specific platform id.
 * @param {string} platformId
 * @returns {object|null}
 */
export function getPlatform(platformId) {
  if (!platformId || typeof platformId !== "string") return null;
  return PLATFORMS[platformId.toLowerCase()] || null;
}

/**
 * Check whether a platform is recognized in the registry.
 * @param {string} platformId
 * @returns {boolean}
 */
export function isSupportedPlatform(platformId) {
  if (!platformId || typeof platformId !== "string") return false;
  return Boolean(PLATFORMS[platformId.toLowerCase()]);
}

/**
 * Return all registered platform metadata objects as an array.
 * @returns {Array<object>}
 */
export function listPlatforms() {
  return Object.values(PLATFORMS);
}
