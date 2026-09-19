import { registerTab } from "../core/navigation";
import { showToast } from "../core/ui";
import { escapeHtml } from "../core/dom";
import { getConfig } from "../core/api";

// --- Types ---

export type TrendState = "NEW" | "RISING" | "RAPID_RISING" | "PEAK" | "DECLINING" | "DEAD";

export interface FocusTopic {
  id: string;
  name: string;
  icon: string;
  enabled: boolean;
  keywords: string[];
  rss_sources: string[];
}

export interface GeekFeed {
  id: string;
  name: string;
  icon: string;
  url: string;
  enabled: boolean;
  category?: string;
  cookie?: string;
}

export interface TrendIntelConfig {
  scheduler: {
    enabled: boolean;
    interval_minutes: number;
    daily_brief_times: string[];
  };
  model_route: {
    client: string;
    endpoint_index: number;
    model: string;
  };
  proxy: {
    mode: "inherit" | "direct" | "custom";
    custom_url: string;
  };
  platforms: Record<string, boolean>;
  focus_topics: FocusTopic[];
  geek_feeds?: GeekFeed[];
  data_dir?: string;
}

export interface BriefMetadata {
  total_events?: number;
  high_importance_count?: number;
  high_creator_count?: number;
  rapid_rising_count?: number;
  event_links?: Record<string, { url?: string; platform_urls?: Record<string, string> }>;
  generated_at?: string;
}

export interface DailyBrief {
  date: string;
  markdown: string;
  metadata?: BriefMetadata;
  created_at?: string;
}

export interface RawItem {
  id: string;
  platform: string;
  rank: number;
  title: string;
  url?: string;
  hot_value?: string | number;
  category?: string;
  first_seen?: string;
  recorded_at?: string;
}

export interface TrendEvent {
  event_id: string;
  title: string;
  summary?: string;
  world_importance_score: number | null;
  creator_value_score: number | null;
  velocity: number;
  trend_state: TrendState;
  platform_count: number;
  platforms: string[];
  duration_hours: number;
  snapshot_count: number;
  creator_angles?: string[];
  matched_topic?: string;
  created_at?: string;
  updated_at?: string;
}

export interface EventSnapshot {
  id?: string;
  event_id: string;
  platform: string;
  rank: number;
  score?: number | null;
  recorded_at: string;
}

export interface EventHistoryResponse {
  event: TrendEvent;
  snapshots: EventSnapshot[];
}

// --- Platform Metadata ---

export const PLATFORM_INFO: Record<string, { name: string; icon: string; category: string; url?: string }> = {
  weibo: { name: "微博热搜", icon: "🔥", category: "general", url: "https://weibo.com" },
  zhihu: { name: "知乎热榜", icon: "💡", category: "general", url: "https://www.zhihu.com/hot" },
  baidu: { name: "百度热搜", icon: "🔍", category: "general", url: "https://top.baidu.com" },
  bilibili: { name: "B站热搜", icon: "📺", category: "entertainment", url: "https://www.bilibili.com" },
  douyin: { name: "抖音热搜", icon: "🎵", category: "entertainment", url: "https://www.douyin.com" },
  toutiao: { name: "今日头条", icon: "📰", category: "news", url: "https://www.toutiao.com" },
  github: { name: "GitHub Trending", icon: "🐙", category: "tech", url: "https://github.com/trending" },
  "36kr": { name: "36氪", icon: "⚡", category: "tech", url: "https://36kr.com" },
  wallstreetcn: { name: "华尔街见闻", icon: "📈", category: "finance", url: "https://wallstreetcn.com" },
  tieba: { name: "百度贴吧", icon: "💬", category: "community", url: "https://tieba.baidu.com" },
  v2ex: { name: "V2EX", icon: "💻", category: "tech", url: "https://v2ex.com" },
  sspai: { name: "少数派", icon: "📱", category: "tech", url: "https://sspai.com" },
  thepaper: { name: "澎湃新闻", icon: "🗞️", category: "news", url: "https://www.thepaper.cn" },
  cls: { name: "财联社", icon: "💹", category: "finance", url: "https://www.cls.cn" }
};

export const TOPIC_PRESETS: { name: string; icon: string; keywords: string[]; rss_sources: string[] }[] = [
  {
    name: "人工智能与前沿科技",
    icon: "🤖",
    keywords: ["AI", "大模型", "DeepSeek", "算力", "Agent", "OpenAI", "Claude", "英伟达", "具身智能"],
    rss_sources: ["https://36kr.com/feed"]
  },
  {
    name: "智能汽车与出行",
    icon: "🚗",
    keywords: ["智驾", "固态电池", "小米汽车", "特斯拉", "比亚迪", "华为车", "新能源", "自动驾驶"],
    rss_sources: ["https://36kr.com/feed"]
  },
  {
    name: "全球宏观与财经",
    icon: "📈",
    keywords: ["美联储", "PCE", "降息", "非农", "财报", "纳斯达克", "黄金", "关税", "汇率"],
    rss_sources: ["https://36kr.com/feed"]
  },
  {
    name: "泛科技与出海",
    icon: "💻",
    keywords: ["出海", "SaaS", "独立开发", "芯片", "空间计算", "Vision Pro", "独立开发者", "AI应用"],
    rss_sources: ["https://sspai.com/feed"]
  },
  {
    name: "数字娱乐与游戏",
    icon: "🎮",
    keywords: ["Steam", "游戏科学", "黑神话", "虚幻引擎", "AIGC", "二次元", "主机游戏", "Unity"],
    rss_sources: ["https://sspai.com/feed"]
  },
  {
    name: "跨境电商与消费",
    icon: "🛍️",
    keywords: ["TikTok Shop", "Temu", "亚马逊", "独立站", "跨境电商", "品牌出海", "Shein"],
    rss_sources: ["https://36kr.com/feed"]
  }
];

export const RECOMMENDED_RSS_SOURCES = [
  { name: "LINUX DO 每日热门", url: "https://linux.do/top/daily.rss", icon: "🐧" },
  { name: "V2EX 技术热议", url: "https://www.v2ex.com/index.xml", icon: "💻" },
  { name: "36氪快讯", url: "https://36kr.com/feed", icon: "⚡" },
  { name: "少数派", url: "https://sspai.com/feed", icon: "📱" }
];

export const COMMON_EMOJIS = ["🤖", "🐧", "🚗", "📈", "💻", "🎮", "🛍️", "⚡", "🏥", "🔬", "📱", "🚀", "🎬", "🎯", "🔥", "💡"];

// --- Module State ---

export type SubView = "brief" | "raw" | "explorer" | "settings" | "geek";

const state = {
  activeView: "brief" as SubView,
  loading: false,
  crawling: false,
  generating: false,
  saving: false,
  error: "",
  
  // Brief View
  briefDate: new Date().toISOString().slice(0, 10),
  brief: null as DailyBrief | null,
  briefViewMode: "cards" as "cards" | "markdown",

  // Geek Feeds Pure Text Reader View
  geekPlatform: "all",
  geekItems: [] as RawItem[],
  geekFeeds: [] as GeekFeed[],
  geekCounts: {} as Record<string, number>,
  geekLoading: false,
  geekStealthMode: false,
  geekSearch: "",
  geekSummaries: {} as Record<string, { loading: boolean; text?: string; error?: string }>,
  
  // Raw Feeds View
  rawPlatform: "all",
  rawSearch: "",
  rawItems: [] as RawItem[],
  rawLoading: false,
  
  // Trend Explorer View
  explorerState: "ALL",
  explorerSort: "world_desc", // "world_desc" | "creator_desc" | "velocity_desc" | "platform_desc" | "duration_desc"
  explorerTopic: "all",
  explorerSearch: "",
  events: [] as TrendEvent[],
  eventsLoading: false,
  expandedTrajectories: {} as Record<string, { loading: boolean; snapshots?: EventSnapshot[]; error?: string }>,
  
  // Settings View
  config: null as TrendIntelConfig | null,
  configDraft: null as TrendIntelConfig | null,
  gatewayConfig: null as any,
};

// --- API Helpers ---

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

function rootEl(): HTMLElement | null {
  return document.getElementById("trend-intel-root");
}

// --- Data Loaders ---

export async function loadBrief(date?: string): Promise<void> {
  const targetDate = date || state.briefDate;
  state.briefDate = targetDate;
  state.loading = true;
  state.error = "";
  render();

  try {
    const [data, rawData] = await Promise.all([
      apiFetch<DailyBrief>(`/v1/trend-intel/brief?date=${encodeURIComponent(targetDate)}`),
      apiFetch<{ items: RawItem[]; total: number }>("/v1/trend-intel/raw-items?limit=500").catch(() => ({ items: [], total: 0 }))
    ]);
    state.brief = data;
    if (Array.isArray(rawData?.items) && rawData.items.length > 0) {
      state.rawItems = rawData.items;
    }
  } catch (err: any) {
    if (err?.status === 404 || (err?.message && (err.message.includes("404") || err.message.includes("not found") || err.message.includes("Not found") || err.message.includes("No brief")))) {
      state.brief = null;
    } else {
      state.brief = null;
      state.error = err?.message || "简报加载失败";
    }
  } finally {
    state.loading = false;
    render();
  }
}

export async function loadRawItems(): Promise<void> {
  state.rawLoading = true;
  render();
  try {
    const qs = new URLSearchParams();
    if (state.rawPlatform && state.rawPlatform !== "all") {
      qs.set("platform", state.rawPlatform);
    }
    qs.set("limit", "200");
    const res = await apiFetch<{ items: RawItem[]; total: number }>(`/v1/trend-intel/raw-items?${qs.toString()}`);
    state.rawItems = Array.isArray(res.items) ? res.items : [];
  } catch (err: any) {
    state.error = err?.message || "原始榜单加载失败";
  } finally {
    state.rawLoading = false;
    render();
  }
}

export async function loadEvents(): Promise<void> {
  state.eventsLoading = true;
  render();
  try {
    const qs = new URLSearchParams();
    if (state.explorerState && state.explorerState !== "ALL") {
      qs.set("state", state.explorerState);
    }
    if (state.explorerTopic && state.explorerTopic !== "all") {
      qs.set("matched_topic", state.explorerTopic);
    }
    qs.set("limit", "100");
    const res = await apiFetch<{ events: TrendEvent[]; total: number }>(`/v1/trend-intel/events?${qs.toString()}`);
    state.events = Array.isArray(res.events) ? res.events : [];
  } catch (err: any) {
    state.error = err?.message || "趋势大盘事件加载失败";
  } finally {
    state.eventsLoading = false;
    render();
  }
}

export async function loadConfig(): Promise<void> {
  try {
    const [cfg, gwCfg] = await Promise.all([
      apiFetch<TrendIntelConfig>("/v1/trend-intel/config"),
      getConfig()
    ]);
    state.config = cfg;
    state.configDraft = JSON.parse(JSON.stringify(cfg));
    state.gatewayConfig = gwCfg;
    if (Array.isArray(cfg.geek_feeds)) {
      state.geekFeeds = cfg.geek_feeds;
    }
  } catch (err: any) {
    state.error = err?.message || "配置加载失败";
  }
  render();
}

export async function loadGeekItems(targetFeed?: string): Promise<void> {
  state.geekLoading = true;
  render();
  try {
    const qs = new URLSearchParams();
    const feedToFetch = targetFeed !== undefined ? targetFeed : state.geekPlatform;
    if (feedToFetch && feedToFetch !== "all") {
      qs.set("feed", feedToFetch);
    }
    qs.set("limit", "150");
    const res = await apiFetch<{ feeds: GeekFeed[]; items: RawItem[]; counts?: Record<string, number> }>(`/v1/trend-intel/geek-items?${qs.toString()}`);
    state.geekFeeds = Array.isArray(res.feeds) ? res.feeds : [];
    state.geekItems = Array.isArray(res.items) ? res.items : [];
    if (res.counts) {
      state.geekCounts = res.counts;
    }
  } catch (err: any) {
    state.error = err?.message || "极客速览数据加载失败";
  } finally {
    state.geekLoading = false;
    render();
  }
}

export async function triggerSummarizeGeekItem(itemId: string): Promise<void> {
  const item = state.geekItems.find(it => it.id === itemId);
  if (!item) return;

  state.geekSummaries[itemId] = { loading: true };
  render();

  try {
    const raw = (item as any).raw || {};
    const res = await apiFetch<{ summary: string; model: string }>("/v1/trend-intel/summarize-item", {
      method: "POST",
      body: JSON.stringify({
        title: item.title,
        content: raw.description || raw.summary || "",
        url: item.url || ""
      })
    });
    state.geekSummaries[itemId] = { loading: false, text: res.summary };
  } catch (err: any) {
    state.geekSummaries[itemId] = { loading: false, error: err?.message || "总结生成失败" };
  } finally {
    render();
  }
}

export async function triggerCrawl(): Promise<void> {
  state.crawling = true;
  render();
  try {
    const res = await apiFetch<{ count: number; duration_ms: number }>("/v1/trend-intel/crawl", { method: "POST" });
    showToast(`抓取完成！共捕获 ${res.count} 条热榜条目 (${res.duration_ms}ms)`, "success");
    // Reload relevant views
    void loadGeekItems();
    if (state.activeView === "raw") await loadRawItems();
    if (state.activeView === "explorer") await loadEvents();
  } catch (err: any) {
    showToast(`抓取失败: ${err?.message || err}`, "error");
  } finally {
    state.crawling = false;
    render();
  }
}

export async function triggerGenerateBrief(): Promise<void> {
  state.generating = true;
  render();
  try {
    showToast("正在同步最新热榜并执行 AI 深度研判…", "info");
    const res = await apiFetch<{ brief: DailyBrief; events: TrendEvent[] }>("/v1/trend-intel/generate-brief", {
      method: "POST",
      body: JSON.stringify({ date: state.briefDate })
    });
    state.brief = res.brief;
    showToast(`简报已生成！聚合 ${res.events?.length || 0} 项热点事件`, "success");
  } catch (err: any) {
    showToast(`简报生成失败: ${err?.message || err}`, "error");
  } finally {
    state.generating = false;
    render();
  }
}

export async function toggleTrajectory(eventId: string): Promise<void> {
  const cur = state.expandedTrajectories[eventId];
  if (cur && cur.snapshots) {
    delete state.expandedTrajectories[eventId];
    render();
    return;
  }

  state.expandedTrajectories[eventId] = { loading: true };
  render();

  try {
    const data = await apiFetch<EventHistoryResponse>(`/v1/trend-intel/events/${encodeURIComponent(eventId)}/history`);
    state.expandedTrajectories[eventId] = {
      loading: false,
      snapshots: data.snapshots || []
    };
  } catch (err: any) {
    state.expandedTrajectories[eventId] = {
      loading: false,
      error: err?.message || "轨迹加载失败"
    };
  }
  render();
}

export async function saveSettings(): Promise<void> {
  if (!state.configDraft) return;
  state.saving = true;
  render();
  try {
    const updated = await apiFetch<TrendIntelConfig>("/v1/trend-intel/config", {
      method: "PUT",
      body: JSON.stringify(state.configDraft)
    });
    state.config = updated;
    state.configDraft = JSON.parse(JSON.stringify(updated));
    showToast("热点情报模块配置已成功保存！", "success");
  } catch (err: any) {
    showToast(`保存失败: ${err?.message || err}`, "error");
  } finally {
    state.saving = false;
    render();
  }
}

// --- Clipboard & AI Actions ---

export function copyText(text: string, toastMessage = "已复制到剪贴板"): void {
  navigator.clipboard.writeText(text).then(
    () => showToast(toastMessage, "success"),
    () => showToast("复制失败，请手动复制", "error")
  );
}

export function copyRawAnalyzePrompt(title: string, platform: string, rank: number, hotValue?: string | number): void {
  const platName = PLATFORM_INFO[platform]?.name || platform;
  const rankText = rank ? `#${rank}` : "";
  const hotText = hotValue ? `热度: ${hotValue}` : "";
  const prompt = `请对热榜条目「${title}」（来源：${platName} ${rankText} ${hotText}）进行深度剖析：
1. 核心事实：厘清事件起因、经过与当前发展现状；
2. 舆论关注点：公众与行业在这个话题上最关注/争议的关键点是什么；
3. 创作切入角度：为自媒体/科技/商业博主提供 3 个差异化选题切入点与脚本结构建议。`;
  copyText(prompt, `已复制「${title}」的 AI 深度分析提示词`);
}

export function copyEventIdeatePrompt(evt: TrendEvent): void {
  const platText = (evt.platforms || []).map(p => PLATFORM_INFO[p]?.name || p).join(", ");
  const prompt = `请基于全网聚合热点事件「${evt.title}」进行爆款内容策划：
- 事件背景：${evt.summary || evt.title}
- 宏观重要度评分：${evt.world_importance_score ?? "-"}/10
- 创作者价值评分：${evt.creator_value_score ?? "-"}/10
- 爆发趋势：${evt.trend_state} (上升速度: ${evt.velocity > 0 ? "+" + evt.velocity : evt.velocity} 排名/时)
- 覆盖平台：${platText || "全网"}

请为我生成：
1. 3 套针对不同受众画像的爆款标题（悬念型、深度干货型、争议思辨型）；
2. 核心冲突与受众痛点分析；
3. 详尽的短视频/图文行文大纲（含开头黄金 3 秒钩子、中段论证逻辑与结尾金句）。`;
  copyText(prompt, `已复制「${evt.title}」的选题策划提示词`);
}

// --- Render Helpers ---

function formatTimeShort(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${mins}`;
  } catch {
    return "";
  }
}

function renderHeaderNav(): string {
  const tabs = [
    { id: "brief" as SubView, label: "📰 今日简报", desc: "Daily Brief" },
    { id: "geek" as SubView, label: "💻 极客速览", desc: "Geek Reader" },
    { id: "raw" as SubView, label: "📑 原始榜单", desc: "Raw Feeds" },
    { id: "explorer" as SubView, label: "📈 趋势大盘", desc: "Trend Explorer" },
    { id: "settings" as SubView, label: "⚙️ 模块配置", desc: "Settings" }
  ];

  return `
    <div class="trend-intel-nav">
      <div class="trend-intel-nav-left">
        <div class="trend-intel-logo-group">
          <div class="trend-intel-title">热点情报 (Trend Radar)</div>
          <div class="trend-intel-badge">AI 趋势引擎</div>
        </div>
      </div>
      <div class="trend-intel-tabs">
        ${tabs.map(t => `
          <button 
            type="button"
            class="trend-intel-tab-btn ${state.activeView === t.id ? "active" : ""}" 
            onclick="window.__trendIntelSwitchView('${t.id}')">
            ${escapeHtml(t.label)}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

interface ParsedBriefItem {
  title: string;
  url?: string;
  platformUrls?: Record<string, string>;
  worldScore?: string;
  creatorScore?: string;
  trendState?: string;
  velocity?: string;
  platforms: string[];
  summary?: string;
  creatorAngles: string[];
  timeWindow?: string;
}

interface ParsedSection {
  title: string;
  icon: string;
  badgeClass: string;
  items: ParsedBriefItem[];
}

function getPlatformMeta(p: string): { id: string; name: string; icon: string; url?: string } {
  const key = String(p || "").toLowerCase().trim();
  if (PLATFORM_INFO[key]) return { id: key, ...PLATFORM_INFO[key] };
  for (const [k, v] of Object.entries(PLATFORM_INFO)) {
    if (v.name === p || v.name.includes(p) || p.includes(v.name)) return { id: k, ...v };
  }
  return { id: key, name: p, icon: "🌐" };
}

function findDirectUrlForTitle(title: string, platform?: string): string {
  if (!title || !state.rawItems || state.rawItems.length === 0) return "";
  const cleanTitle = title.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  if (!cleanTitle) return "";

  // 1. Try matching within specific platform first
  if (platform) {
    const p = platform.toLowerCase().trim();
    for (const item of state.rawItems) {
      if (item.platform && item.platform.toLowerCase() === p && item.url && item.title) {
        const cleanItemTitle = item.title.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
        if (cleanTitle.includes(cleanItemTitle) || cleanItemTitle.includes(cleanTitle)) {
          return item.url;
        }
      }
    }
  }

  // 2. Try matching across all platforms
  for (const item of state.rawItems) {
    if (item.url && item.title) {
      const cleanItemTitle = item.title.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
      if (cleanTitle.includes(cleanItemTitle) || cleanItemTitle.includes(cleanTitle)) {
        return item.url;
      }
    }
  }
  return "";
}

function getPlatformSearchUrl(platform: string, title: string, directUrl?: string): string {
  if (directUrl && /^https?:\/\//i.test(directUrl)) return directUrl;
  const p = platform.toLowerCase().trim();
  const directMatch = findDirectUrlForTitle(title, p);
  if (directMatch) return directMatch;

  const enc = encodeURIComponent(title);
  switch (p) {
    case "baidu": return `https://www.baidu.com/s?wd=${enc}`;
    case "weibo": return `https://s.weibo.com/weibo?q=${enc}`;
    case "zhihu": return `https://www.zhihu.com/search?type=content&q=${enc}`;
    case "bilibili": return `https://search.bilibili.com/all?keyword=${enc}`;
    case "douyin": return `https://www.douyin.com/search/${enc}`;
    case "toutiao": return `https://www.toutiao.com/search/?keyword=${enc}`;
    case "github": return `https://github.com/search?q=${enc}&type=repositories`;
    case "tieba": return `https://tieba.baidu.com/f/search/res?kw=&qw=${enc}`;
    case "v2ex": return `https://www.google.com/search?q=site:v2ex.com+${enc}`;
    case "sspai": return `https://sspai.com/search/post/${enc}`;
    case "36kr":
    case "wallstreetcn":
    case "cls":
    case "thepaper":
      // For platforms whose internal search breaks on long sentences, use Baidu targeted search
      return `https://www.baidu.com/s?wd=${encodeURIComponent(p + " " + title)}`;
    default:
      return `https://www.baidu.com/s?wd=${enc}`;
  }
}

function parseMarkdownToSections(md: string, eventLinks?: Record<string, { url?: string; platform_urls?: Record<string, string> }>): ParsedSection[] {
  if (!md) return [];
  const sections: ParsedSection[] = [];
  const lines = md.split("\n");
  let currentSection: ParsedSection | null = null;
  let currentItem: ParsedBriefItem | null = null;
  let inAngles = false;

  const pushItem = () => {
    if (currentItem && currentSection) {
      if (currentItem.summary && currentItem.summary.trim() === currentItem.title.trim()) {
        currentItem.summary = undefined;
      }
      if (eventLinks && eventLinks[currentItem.title]) {
        const linkInfo = eventLinks[currentItem.title];
        currentItem.url = linkInfo.url || currentItem.url;
        currentItem.platformUrls = linkInfo.platform_urls || currentItem.platformUrls;
      }
      currentSection.items.push(currentItem);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("## ")) {
      pushItem();
      currentItem = null;
      inAngles = false;
      const title = trimmed.replace("## ", "").trim();
      let icon = "📌";
      let badgeClass = "badge-default";
      if (title.includes("必须知道") || title.startsWith("①")) {
        icon = "🚨";
        badgeClass = "badge-danger";
      } else if (title.includes("快速升温") || title.startsWith("②")) {
        icon = "🚀";
        badgeClass = "badge-success";
      } else if (title.includes("值得做") || title.startsWith("③")) {
        icon = "💡";
        badgeClass = "badge-warning";
      } else if (title.includes("值得知道") || title.startsWith("④")) {
        icon = "👀";
        badgeClass = "badge-info";
      } else if (title.includes("大众舆论") || title.startsWith("⑤")) {
        icon = "💬";
        badgeClass = "badge-neutral";
      } else if (title.includes("重点赛道") || title.startsWith("🎯")) {
        icon = "🎯";
        badgeClass = "badge-brand";
      }

      currentSection = { title, icon, badgeClass, items: [] };
      sections.push(currentSection);
      continue;
    }

    if (trimmed.startsWith("- **【")) {
      pushItem();
      inAngles = false;
      
      const titleMatch = trimmed.match(/- \*\*【(.*?)】\*\*(.*)/);
      const title = titleMatch ? titleMatch[1].trim() : trimmed.replace(/^-\s*/, "");
      const metaPart = titleMatch ? titleMatch[2].trim() : "";

      const worldMatch = metaPart.match(/世界重要度:\s*([\d\.]+(?:\/10)?)/);
      const creatorMatch = metaPart.match(/创作价值:\s*([\d\.]+(?:\/10)?)/);
      const stateMatch = metaPart.match(/状态:\s*([A-Za-z_]+)/);
      const velMatch = metaPart.match(/速度:\s*([+-]?\d+(?:\.\d+)?(?:\s*排名\/时)?)/);
      const platMatch = metaPart.match(/平台:\s*([^)|]+)/);
      const linkMatch = metaPart.match(/链接:\s*([^\s)]+)/);
      
      const platforms = platMatch 
        ? platMatch[1].split(/[,，]/).map(s => s.trim()).filter(Boolean)
        : [];

      currentItem = {
        title,
        url: linkMatch ? linkMatch[1] : undefined,
        worldScore: worldMatch ? worldMatch[1].replace("/10", "") : undefined,
        creatorScore: creatorMatch ? creatorMatch[1].replace("/10", "") : undefined,
        trendState: stateMatch ? stateMatch[1] : undefined,
        velocity: velMatch ? velMatch[1] : undefined,
        platforms,
        creatorAngles: []
      };
      continue;
    }

    if (currentItem) {
      if (trimmed.includes("切入角度") || trimmed.includes("选题建议")) {
        inAngles = true;
        continue;
      }
      if (trimmed.includes("建议窗口") || trimmed.includes("建议窗口期")) {
        inAngles = false;
        const wMatch = trimmed.match(/建议窗口期?[：:]\s*(.*)/);
        const rawW = wMatch ? wMatch[1] : trimmed;
        currentItem.timeWindow = rawW.replace(/^[⏱⏳\s*]+/, "").replace(/\*+$/, "").trim();
        continue;
      }
      if (inAngles && (rawLine.startsWith("    - ") || rawLine.startsWith("  - ") || trimmed.startsWith("- "))) {
        const angleText = trimmed.replace(/^-\s*/, "").replace(/^\*+|\*+$/g, "").trim();
        if (angleText && !angleText.includes("切入角度")) {
          currentItem.creatorAngles.push(angleText);
        }
        continue;
      }
      if (trimmed.startsWith("- 📌") || trimmed.startsWith("📌") || trimmed.startsWith("-")) {
        inAngles = false;
        const text = trimmed
          .replace(/^[-\s*📌]+/, "")
          .replace(/^(核心事实|动态速递|事件概述|观察聚焦|讨论焦点|赛道要闻|观察说明)?[：:\s*]*/, "")
          .replace(/^[：:\s*]+/, "")
          .trim();
        if (text && text !== currentItem.title) {
          currentItem.summary = (currentItem.summary ? currentItem.summary + " " : "") + text;
        }
      }
    }
  }

  pushItem();

  return sections;
}

// --- Sub-View 1.5: Geek Feeds (Pure-Text Reader Card) ---

function renderGeekCard(isFullPage = false): string {
  const feeds = state.geekFeeds || [];
  const currentFeed = feeds.find(f => f.id === state.geekPlatform);
  const items = (state.geekItems || []).filter(item => {
    if (state.geekPlatform !== "all" && item.platform !== state.geekPlatform) {
      return false;
    }
    if (!state.geekSearch) return true;
    const q = state.geekSearch.toLowerCase();
    const raw = (item as any).raw || {};
    const text = `${item.title || ""} ${raw.summary || ""} ${raw.description || ""}`.toLowerCase();
    return text.includes(q);
  });

  const getFeedCount = (feedId: string): number => {
    if (state.geekCounts && state.geekCounts[feedId] !== undefined) {
      return state.geekCounts[feedId];
    }
    return (state.geekItems || []).filter(i => i.platform === feedId).length;
  };
  const totalCount = state.geekCounts?.all ?? (state.geekItems || []).length;

  return `
    <div class="trend-intel-geek-card ${isFullPage ? "full-page" : ""}">
      <div class="geek-card-header">
        <div class="geek-title-group">
          <span class="geek-card-icon">💻</span>
          <div>
            <div class="geek-card-title">极客纯文本速览 (Geek Feeds)</div>
            <div class="geek-card-subtitle">等宽终端排版 · 摸鱼防窥 · 支持 LINUX DO / V2EX / 自定义 RSS</div>
          </div>
        </div>
        <div class="geek-header-actions">
          <div class="geek-search-box">
            <input 
              type="text" 
              placeholder="过滤标题/摘要..." 
              value="${escapeHtml(state.geekSearch)}" 
              oninput="window.__trendIntelSearchGeek(this.value)" />
          </div>
          <button 
            class="btn btn-xs btn-outline" 
            onclick="window.__trendIntelCopySyncScript()" 
            title="复制 1 键同步脚本：在已打开的 linux.do 网页控制台 (F12) 粘贴回车即可秒同步最新热帖">
            ⚡ 复制同步脚本
          </button>
          <button 
            class="btn btn-xs ${state.geekStealthMode ? "btn-warning" : "btn-secondary"}" 
            onclick="window.__trendIntelToggleStealth()" 
            title="快捷切换摸鱼伪装模式（伪装成网关运行日志）">
            ${state.geekStealthMode ? "🟢 退出伪装" : "🕶️ 摸鱼伪装 (Boss Key)"}
          </button>
          <button 
            class="btn btn-xs" 
            onclick="window.__trendIntelRefreshGeek()" 
            ${state.geekLoading || state.crawling ? "disabled" : ""}
            title="刷新极客资讯">
            🔄 刷新
          </button>
          <button 
            class="btn btn-xs" 
            onclick="window.__trendIntelSwitchView('settings')" 
            title="去配置更多 RSS 订阅源">
            ⚙️ 订阅管理
          </button>
        </div>
      </div>

      <!-- Feed Pills -->
      <div class="geek-feed-pills">
        <button 
          class="geek-pill ${state.geekPlatform === "all" ? "active" : ""}" 
          onclick="window.__trendIntelSetGeekPlatform('all')">
          🌐 全部订阅 (${totalCount})
        </button>
        ${feeds.map(feed => {
          const isSelected = state.geekPlatform === feed.id;
          const count = getFeedCount(feed.id);
          const needsCookie = feed.id === "linux_do" && !feed.cookie;
          const badgeText = needsCookie && count === 0 ? "⚠️待授权" : String(count);
          return `
            <button 
              class="geek-pill ${isSelected ? "active" : ""} ${feed.enabled === false ? "disabled" : ""} ${needsCookie && count === 0 ? "needs-auth" : ""}" 
              onclick="window.__trendIntelSetGeekPlatform('${escapeHtml(feed.id)}')">
              ${escapeHtml(feed.icon || "💻")} ${escapeHtml(feed.name)} (${badgeText})
            </button>
          `;
        }).join("")}
      </div>

      <!-- Main Body -->
      ${state.geekStealthMode ? `
        <div class="trend-intel-stealth-terminal" onclick="window.__trendIntelToggleStealth()" title="点击任意位置恢复纯文本资讯流">
          <div class="stealth-terminal-header">
            <span>TERMINAL · [Shrimp Gateway Daemon - Telemetry Monitor]</span>
            <span class="stealth-hint">(已开启伪装，点击任意位置恢复)</span>
          </div>
          <div class="stealth-terminal-logs">
            <div class="stealth-line info"><span class="time">[18:32:01.402]</span> <span class="badge">[SYSTEM/INIT]</span> Node.js runtime active. Memory RSS: 64.2 MB.</div>
            <div class="stealth-line debug"><span class="time">[18:32:05.118]</span> <span class="badge">[ROUTE-PROXY]</span> Upstream socket keep-alive pool recycled. Health: OK.</div>
            <div class="stealth-line info"><span class="time">[18:32:11.890]</span> <span class="badge">[TELEMETRY]</span> Syncing token usage records: 1,420 prompt tokens committed to SQLite WAL.</div>
            <div class="stealth-line trace"><span class="time">[18:32:18.005]</span> <span class="badge">[CACHE-ENGINE]</span> LRU cache hit ratio 98.7%. Garbage collector idle.</div>
            <div class="stealth-line debug"><span class="time">[18:32:24.712]</span> <span class="badge">[DISPATCHER]</span> Thread pool worker #2 heartbeat ack (latency 0.8ms).</div>
            <div class="stealth-line prompt"><span class="time">[18:32:30.000]</span> <span class="cursor">_</span> Metric telemetry idle...</div>
          </div>
        </div>
      ` : (state.geekLoading ? `
        <div class="geek-loading-box">
          <div class="trend-intel-spinner"></div>
          <p>正在读取极客资讯流…</p>
        </div>
      ` : (items.length === 0 ? `
        ${state.geekPlatform === "linux_do" ? `
          <div class="geek-cf-card">
            <div class="geek-cf-header">
              <span class="cf-icon">${currentFeed?.cookie ? "🐧" : "🛡️"}</span>
              <div class="cf-title-wrap">
                <h4>LINUX DO 社区热榜 · ${currentFeed?.cookie ? "后台静默抓取已就绪" : "需要授权访客凭证 (Cookie)"}</h4>
                <p>${currentFeed?.cookie 
                  ? "网关已配置 Cloudflare 访客凭证。后台离屏引擎可全自动静默过盾拉取，无需在浏览器打开目标网站。" 
                  : "LINUX DO 开启了 Cloudflare 5秒盾防护。网关只需您一次性粘贴访客凭证（无需注册账号），即可永久在后台为您全自动静默抓取。"}</p>
              </div>
            </div>

            ${!currentFeed?.cookie ? `
              <!-- 未授权时展示极简获取指引与快捷输入框 -->
              <div class="geek-cf-steps">
                <div><strong>📋 首次使用 3 步获取凭证（无需账号）：</strong></div>
                <div style="margin-left: 8px;">
                  1. 在电脑的 Chrome 或 Edge 浏览器中访问一次 <a href="https://linux.do" target="_blank" style="color:var(--brand-primary); text-decoration:underline;">https://linux.do</a>。<br/>
                  2. 按键盘 <kbd>F12</kbd> 打开开发者工具，切到「<strong>应用 (Application)</strong> / <strong>存储</strong>」➔「<strong>Cookie</strong>」➔「https://linux.do」。<br/>
                  3. 找到名为 <code>cf_clearance</code> 的条目，复制其 Cookie 值并粘贴到下方：
                </div>
              </div>
              <div class="geek-cf-quick-input" style="margin-top: 6px;">
                <input 
                  type="password" 
                  id="quick-feed-cookie-linux_do" 
                  placeholder="在此粘贴 cf_clearance 的值 (例如: m9Qmlvwb...)" />
                <button class="btn btn-sm btn-primary" onclick="window.__trendIntelQuickSaveCookie('linux_do')">
                  💾 保存凭证并立即开始静默抓取
                </button>
                <button class="btn btn-sm" onclick="window.__trendIntelSwitchView('settings')">
                  ⚙️ 更多订阅设置
                </button>
              </div>
            ` : `
              <!-- 已授权但暂无缓存时的操作面板 -->
              <div class="geek-cf-steps">
                <div style="border-left: 3px solid var(--brand-primary, #6366f1); padding-left: 10px;">
                  <div><strong>🚀 全自动静默抓取：</strong> 当前网关凭证有效，点击下方按钮立即让后台离屏引擎抓取最新热帖：</div>
                  <div style="display:flex; gap:8px; margin-top:8px;">
                    <button class="btn btn-sm btn-primary" onclick="window.__trendIntelRefreshGeek()">
                      🔄 立即自动抓取最新热帖
                    </button>
                    <button class="btn btn-sm" onclick="window.__trendIntelSwitchView('settings')">
                      ⚙️ 查看 / 更换 Cookie 配置
                    </button>
                  </div>
                </div>
              </div>
            `}
          </div>
        ` : (state.geekPlatform !== "all" && getFeedCount(state.geekPlatform) === 0 ? `
          <div class="geek-empty-box">
            <div style="font-size: 24px; margin-bottom: 8px;">📡</div>
            <p><strong>「${escapeHtml(currentFeed?.name || state.geekPlatform)}」暂无抓取数据</strong></p>
            <p style="font-size: 11.5px; color: var(--text-secondary); margin-top: 4px;">
              可能尚未执行抓取、订阅源暂时无法连通或需登录 Cookie。你可以点击上方「🔄 刷新」重试。
            </p>
            <div style="margin-top: 12px; display: flex; justify-content: center; gap: 8px;">
              <button class="btn btn-sm" onclick="window.__trendIntelRefreshGeek()">🔄 立即拉取</button>
              <button class="btn btn-sm" onclick="window.__trendIntelSwitchView('settings')">⚙️ 检查订阅配置</button>
            </div>
          </div>
        ` : `
          <div class="geek-empty-box">
            <p>暂无极客资讯。点击上方「🔄 刷新」或「立即抓取榜单」开始抓取订阅源。</p>
          </div>
        `)}
      ` : `
        <div class="geek-stream-list">
          ${items.map(item => {
            const raw = (item as any).raw || {};
            const feedMeta = feeds.find(f => f.id === item.platform) || { name: raw.platformName || item.platform, icon: raw.icon || "💻" };
            const timeStr = item.first_seen_at ? formatTimeShort(item.first_seen_at) : "";
            const summaryText = raw.summary || "";
            const aiSummary = state.geekSummaries[item.id];

            return `
              <div class="geek-stream-row">
                <div class="geek-row-meta">
                  <span class="geek-meta-time">${escapeHtml(timeStr)}</span>
                  <span class="geek-meta-source">${escapeHtml(feedMeta.icon || "💻")} ${escapeHtml(feedMeta.name || item.platform)}</span>
                  <a class="geek-row-title" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noreferrer" title="新标签页打开原帖：${escapeHtml(item.title)}">
                    ${escapeHtml(item.title)}
                    <span class="ext-arrow">↗</span>
                  </a>
                  <div class="geek-row-btns">
                    <button class="btn btn-xs geek-ai-btn" onclick="window.__trendIntelSummarizeGeekItem('${escapeHtml(item.id)}')">
                      ${aiSummary?.loading ? "⏳ 总结中…" : "🤖 AI 总结"}
                    </button>
                    ${item.url ? `
                      <button class="btn btn-xs" onclick="window.__trendIntelCopyUrl('${escapeHtml(item.url)}')">
                        📋 链接
                      </button>
                    ` : ""}
                  </div>
                </div>
                ${summaryText ? `
                  <div class="geek-row-snippet">${escapeHtml(summaryText)}</div>
                ` : ""}
                ${aiSummary?.text ? `
                  <div class="geek-ai-box">
                    <div class="geek-ai-header">🤖 <strong>大模型精要提炼：</strong></div>
                    <div class="geek-ai-content">${escapeHtml(aiSummary.text).replace(/\n/g, "<br/>")}</div>
                  </div>
                ` : (aiSummary?.error ? `
                  <div class="geek-ai-box error">⚠️ 提炼失败: ${escapeHtml(aiSummary.error)}</div>
                ` : "")}
              </div>
            `;
          }).join("")}
        </div>
      `))}
    </div>
  `;
}

function renderGeekFeedsView(): string {
  return `
    <div class="trend-intel-view trend-intel-geek-view">
      ${renderGeekCard(true)}
    </div>
  `;
}

// --- Sub-View 1: Daily Brief ---

function renderBriefView(): string {
  const brief = state.brief;
  const meta = brief?.metadata || {};
  const sections = brief?.markdown ? parseMarkdownToSections(brief.markdown, meta.event_links) : [];

  return `
    <div class="trend-intel-view trend-intel-brief-view">
      <!-- Toolbar -->
      <div class="trend-intel-toolbar">
        <div class="trend-intel-toolbar-left">
          <label class="trend-intel-date-label">
            <span>📅 日期：</span>
            <input 
              type="date" 
              class="trend-intel-date-input" 
              value="${escapeHtml(state.briefDate)}" 
              onchange="window.__trendIntelChangeDate(this.value)" />
          </label>
          <button class="btn btn-sm" onclick="window.__trendIntelQuickDate('today')">今天</button>
          <button class="btn btn-sm" onclick="window.__trendIntelQuickDate('yesterday')">昨天</button>
        </div>
        <div class="trend-intel-toolbar-right">
          <button class="btn btn-sm" onclick="window.__trendIntelCrawl()" ${state.crawling ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${state.crawling ? "trend-intel-spin" : ""}"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            ${state.crawling ? "抓取中…" : "立即抓取榜单"}
          </button>
          <button class="btn btn-sm btn-primary" onclick="window.__trendIntelGenerateBrief()" ${state.generating ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${state.generating ? "trend-intel-spin" : ""}"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            ${state.generating ? "生成中…" : "立即生成简报"}
          </button>
          ${brief ? `
            <button class="btn btn-sm" onclick="window.__trendIntelCopyBriefMarkdown()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
              复制 Markdown
            </button>
            <div class="trend-intel-segmented-toggle">
              <button class="${state.briefViewMode === "cards" ? "active" : ""}" onclick="window.__trendIntelSwitchBriefMode('cards')">卡片视图</button>
              <button class="${state.briefViewMode === "markdown" ? "active" : ""}" onclick="window.__trendIntelSwitchBriefMode('markdown')">源码</button>
            </div>
          ` : ""}
        </div>
      </div>

      <!-- KPI Summary Cards -->
      ${brief ? `
        <div class="trend-intel-kpi-grid">
          <div class="trend-intel-kpi-card">
            <div class="trend-intel-kpi-num">${meta.total_events || 0}</div>
            <div class="trend-intel-kpi-label">📊 覆盖热点事件</div>
          </div>
          <div class="trend-intel-kpi-card highlight-danger">
            <div class="trend-intel-kpi-num">${meta.high_importance_count || 0}</div>
            <div class="trend-intel-kpi-label">🚨 重大宏观事件 (≥8.0)</div>
          </div>
          <div class="trend-intel-kpi-card highlight-warning">
            <div class="trend-intel-kpi-num">${meta.high_creator_count || 0}</div>
            <div class="trend-intel-kpi-label">💡 高创作价值 (≥7.5)</div>
          </div>
          <div class="trend-intel-kpi-card highlight-success">
            <div class="trend-intel-kpi-num">${meta.rapid_rising_count || 0}</div>
            <div class="trend-intel-kpi-label">🚀 极速升温突发</div>
          </div>
        </div>
      ` : ""}

      <!-- Geek Feeds Pure-Text Reader Card -->
      ${renderGeekCard(false)}

      <!-- Content Area -->
      ${state.loading ? `
        <div class="trend-intel-loading-box">
          <div class="trend-intel-spinner"></div>
          <p>正在加载 ${escapeHtml(state.briefDate)} 的热点情报简报…</p>
        </div>
      ` : (!brief ? `
        <div class="trend-intel-empty-box">
          <div class="trend-intel-empty-icon">📰</div>
          <h3>${escapeHtml(state.briefDate)} 暂无热点简报</h3>
          <p>当前日期尚未生成情报简报。点击下方按钮，系统将自动拉取最新全网热榜并由 AI 一键完成双维打分、切入角度研判与智能聚合。</p>
          <div class="trend-intel-empty-actions">
            <button class="btn btn-primary" onclick="window.__trendIntelGenerateBrief()" ${state.generating ? "disabled" : ""}>
              ⚡ 一键生成该日简报
            </button>
            <button class="btn" onclick="window.__trendIntelCrawl()" ${state.crawling ? "disabled" : ""}>
              🔄 抓取全网最新榜单
            </button>
          </div>
        </div>
      ` : (state.briefViewMode === "markdown" ? `
        <div class="trend-intel-raw-md-wrap">
          <div class="trend-intel-raw-md-header">
            <span>Markdown 简报源文件 (${brief.markdown.length} 字符)</span>
            <button class="btn btn-sm" onclick="window.__trendIntelCopyBriefMarkdown()">一键复制</button>
          </div>
          <pre class="trend-intel-raw-md"><code>${escapeHtml(brief.markdown)}</code></pre>
        </div>
      ` : `
        <!-- Sections Layout -->
        <div class="trend-intel-sections-layout">
          ${sections.map((sec) => `
            <div class="trend-intel-section-card ${sec.badgeClass}">
              <div class="trend-intel-section-header">
                <div class="trend-intel-section-title-wrap">
                  <span class="trend-intel-section-icon">${sec.icon}</span>
                  <h3>${escapeHtml(sec.title)}</h3>
                </div>
                <span class="trend-intel-section-count">${sec.items.length} 个热点</span>
              </div>
              <div class="trend-intel-section-cards-grid">
                ${sec.items.length === 0 ? `<p class="trend-intel-sec-empty">本栏目今日暂无突出条目</p>` : sec.items.map(item => {
                  const primaryPlatform = item.platforms?.[0] || "";
                  const directPlatformUrl = primaryPlatform && item.platformUrls?.[primaryPlatform];
                  const targetUrl = item.url || directPlatformUrl || getPlatformSearchUrl(primaryPlatform, item.title);
                  const isDuplicateSummary = !item.summary || item.summary.trim() === item.title.trim();

                  return `
                    <div class="trend-intel-brief-card">
                      <!-- Card Header: Badges & Platforms -->
                      <div class="trend-intel-card-header">
                        <div class="trend-intel-card-badges">
                          ${item.worldScore ? `
                            <span class="trend-badge badge-world" title="世界重要性：反映事件对宏观社会、经济与行业的影响力">
                              <span class="badge-dot"></span>重要度 <strong>${escapeHtml(item.worldScore)}</strong>
                            </span>
                          ` : ""}
                          ${item.creatorScore ? `
                            <span class="trend-badge badge-creator" title="内容创作价值：反映事件是否存在认知差/信息差，适合自媒体选题">
                              <span class="badge-dot"></span>创作价值 <strong>${escapeHtml(item.creatorScore)}</strong>
                            </span>
                          ` : ""}
                          ${item.trendState ? `
                            <span class="trend-badge badge-state ${item.trendState === "RAPID_RISING" ? "state-rapid" : ""}">
                              🚀 ${escapeHtml(item.trendState)} ${item.velocity ? `(${escapeHtml(item.velocity)})` : ""}
                            </span>
                          ` : ""}
                        </div>
                        ${item.platforms && item.platforms.length > 0 ? `
                          <div class="trend-intel-card-platforms">
                            ${item.platforms.map(p => {
                              const meta = getPlatformMeta(p);
                              const pUrl = (item.platformUrls && item.platformUrls[meta.id]) || getPlatformSearchUrl(meta.id, item.title);
                              return `
                                <a class="trend-platform-tag clickable" 
                                   href="javascript:void(0)" 
                                   onclick="event.stopPropagation(); window.__trendIntelOpenUrl('${escapeHtml(pUrl)}')"
                                   title="在新标签页查看 ${escapeHtml(meta.name)} 原帖/搜索">
                                  <span>${meta.icon} ${escapeHtml(meta.name)}</span>
                                  <span class="tag-ext-icon">↗</span>
                                </a>
                              `;
                            }).join("")}
                          </div>
                        ` : ""}
                      </div>

                      <!-- Full-Width Card Title (Clickable) -->
                      <h4 class="trend-intel-card-title has-link" 
                          onclick="window.__trendIntelOpenUrl('${escapeHtml(targetUrl)}')"
                          title="点击在新标签页打开原帖：${escapeHtml(item.title)}">
                        <span class="trend-intel-title-text">${escapeHtml(item.title)}</span>
                        <span class="trend-intel-title-ext">↗</span>
                      </h4>

                      <!-- Card Summary (Deduplicated) -->
                      ${!isDuplicateSummary ? `
                        <p class="trend-intel-card-summary">${escapeHtml(item.summary!)}</p>
                      ` : ""}

                      <!-- Angles Callout Box -->
                      ${item.creatorAngles && item.creatorAngles.length > 0 ? `
                        <div class="trend-intel-angles-box">
                          <div class="trend-intel-angles-title">🎯 差异化创作切入角度：</div>
                          <ul class="trend-intel-angles-list">
                            ${item.creatorAngles.map(a => `<li>${escapeHtml(a)}</li>`).join("")}
                          </ul>
                        </div>
                      ` : ""}

                      <!-- Card Footer Actions -->
                      <div class="trend-intel-card-footer">
                        ${item.timeWindow ? `
                          <span class="trend-intel-window-tag" title="建议发布窗口期">⏳ ${escapeHtml(item.timeWindow)}</span>
                        ` : `<span style="flex:1;"></span>`}
                        <div class="trend-intel-card-btns">
                          <button class="btn btn-xs btn-outline" onclick="window.__trendIntelOpenUrl('${escapeHtml(targetUrl)}')">
                            🔗 查阅原帖 ↗
                          </button>
                          <button class="btn btn-xs" onclick="window.__trendIntelAnalyzeRaw('${escapeHtml(item.title)}', '全网', 1, '')">
                            💡 让AI深度解析
                          </button>
                          <button class="btn btn-xs btn-primary" onclick="window.__trendIntelIdeateFromBrief('${escapeHtml(item.title)}')">
                            ✨ 复制选题大纲
                          </button>
                        </div>
                      </div>
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      `))}
    </div>
  `;
}

// --- Sub-View 2: Raw Feeds ---

function renderRawFeedsView(): string {
  const platforms = Object.entries(PLATFORM_INFO);
  const items = state.rawItems.filter(item => {
    if (!state.rawSearch) return true;
    const q = state.rawSearch.toLowerCase();
    return (item.title || "").toLowerCase().includes(q) || (item.platform || "").toLowerCase().includes(q);
  });

  return `
    <div class="trend-intel-view trend-intel-raw-view">
      <!-- Toolbar & Platform Filter -->
      <div class="trend-intel-toolbar">
        <div class="trend-intel-search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input 
            type="text" 
            placeholder="搜索热榜条目标题、关键词..." 
            value="${escapeHtml(state.rawSearch)}" 
            oninput="window.__trendIntelSearchRaw(this.value)" />
          ${state.rawSearch ? `<button class="trend-intel-search-clear" onclick="window.__trendIntelSearchRaw('')">✕</button>` : ""}
        </div>
        <div class="trend-intel-toolbar-right">
          <span class="trend-intel-feed-count">共 ${items.length} 项</span>
          <button class="btn btn-sm" onclick="window.__trendIntelCrawl()" ${state.crawling ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${state.crawling ? "trend-intel-spin" : ""}"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            ${state.crawling ? "抓取中…" : "抓取全网最新数据"}
          </button>
        </div>
      </div>

      <!-- Platform Pills -->
      <div class="trend-intel-platform-pills">
        <button 
          class="trend-intel-pill ${state.rawPlatform === "all" ? "active" : ""}" 
          onclick="window.__trendIntelSetRawPlatform('all')">
          🌐 全部平台
        </button>
        ${platforms.map(([id, info]) => `
          <button 
            class="trend-intel-pill ${state.rawPlatform === id ? "active" : ""}" 
            onclick="window.__trendIntelSetRawPlatform('${id}')">
            ${info.icon} ${escapeHtml(info.name)}
          </button>
        `).join("")}
      </div>

      <!-- List of Raw Feeds -->
      ${state.rawLoading ? `
        <div class="trend-intel-loading-box">
          <div class="trend-intel-spinner"></div>
          <p>正在拉取榜单条目…</p>
        </div>
      ` : (items.length === 0 ? `
        <div class="trend-intel-empty-box">
          <div class="trend-intel-empty-icon">📑</div>
          <h3>暂无匹配的热榜数据</h3>
          <p>尚未抓取该平台数据或未找到匹配关键词条目。点击下方按钮立即抓取。</p>
          <button class="btn btn-primary" onclick="window.__trendIntelCrawl()" ${state.crawling ? "disabled" : ""}>
            🔄 立即抓取榜单
          </button>
        </div>
      ` : `
        <div class="trend-intel-raw-table-wrap">
          <table class="trend-intel-table">
            <thead>
              <tr>
                <th style="width: 60px;">排名</th>
                <th style="width: 140px;">平台</th>
                <th>标题与链接</th>
                <th style="width: 120px;">热度值</th>
                <th style="width: 140px; text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => {
                const plat = PLATFORM_INFO[item.platform] || { name: item.platform, icon: "📌" };
                const rankClass = item.rank === 1 ? "rank-1" : (item.rank === 2 ? "rank-2" : (item.rank === 3 ? "rank-3" : ""));
                return `
                  <tr>
                    <td>
                      <span class="trend-intel-rank-badge ${rankClass}">#${item.rank}</span>
                    </td>
                    <td>
                      <span class="trend-intel-platform-tag">
                        ${plat.icon} ${escapeHtml(plat.name)}
                      </span>
                    </td>
                    <td>
                      <div class="trend-intel-raw-title-cell">
                        ${item.url ? `
                          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="trend-intel-raw-link">
                            ${escapeHtml(item.title)}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                          </a>
                        ` : `
                          <span class="trend-intel-raw-text">${escapeHtml(item.title)}</span>
                        `}
                      </div>
                    </td>
                    <td>
                      <span class="trend-intel-hot-val">${escapeHtml(String(item.hot_value || "-"))}</span>
                    </td>
                    <td style="text-align: right;">
                      <button 
                        class="btn btn-xs trend-intel-btn-ai" 
                        title="复制 AI 分析提示词"
                        onclick="window.__trendIntelAnalyzeRaw('${escapeHtml(item.title)}', '${escapeHtml(item.platform)}', ${item.rank}, '${escapeHtml(String(item.hot_value || ""))}')">
                        💡 让AI分析此条
                      </button>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `)}
    </div>
  `;
}

// --- Sub-View 3: Trend Explorer ---

function renderTrendExplorerView(): string {
  const states: Array<{ id: string; label: string }> = [
    { id: "ALL", label: "全部" },
    { id: "RAPID_RISING", label: "🚀 快速升温" },
    { id: "PEAK", label: "🔥 峰值" },
    { id: "RISING", label: "📈 攀升中" },
    { id: "NEW", label: "✨ 新生" },
    { id: "DECLINING", label: "📉 回落" },
    { id: "DEAD", label: "💤 沉寂" }
  ];

  let filtered = state.events.filter(e => {
    if (state.explorerState !== "ALL" && e.trend_state !== state.explorerState) return false;
    if (state.explorerTopic !== "all" && e.matched_topic !== state.explorerTopic) return false;
    if (state.explorerSearch) {
      const q = state.explorerSearch.toLowerCase();
      return (e.title || "").toLowerCase().includes(q) || (e.summary || "").toLowerCase().includes(q);
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    switch (state.explorerSort) {
      case "world_desc":
        return (b.world_importance_score || 0) - (a.world_importance_score || 0);
      case "creator_desc":
        return (b.creator_value_score || 0) - (a.creator_value_score || 0);
      case "velocity_desc":
        return (b.velocity || 0) - (a.velocity || 0);
      case "platform_desc":
        return (b.platform_count || 0) - (a.platform_count || 0);
      case "duration_desc":
        return (b.duration_hours || 0) - (a.duration_hours || 0);
      default:
        return 0;
    }
  });

  const topics = state.config?.focus_topics || [];

  return `
    <div class="trend-intel-view trend-intel-explorer-view">
      <!-- Toolbar -->
      <div class="trend-intel-toolbar">
        <div class="trend-intel-search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input 
            type="text" 
            placeholder="搜索聚合趋势事件、话题..." 
            value="${escapeHtml(state.explorerSearch)}" 
            oninput="window.__trendIntelSearchExplorer(this.value)" />
          ${state.explorerSearch ? `<button class="trend-intel-search-clear" onclick="window.__trendIntelSearchExplorer('')">✕</button>` : ""}
        </div>
        <div class="trend-intel-toolbar-right">
          <label class="trend-intel-filter-select-label">
            <span>排序：</span>
            <select class="trend-intel-select" onchange="window.__trendIntelSetExplorerSort(this.value)">
              <option value="world_desc" ${state.explorerSort === "world_desc" ? "selected" : ""}>🌐 世界重要度 ↓</option>
              <option value="creator_desc" ${state.explorerSort === "creator_desc" ? "selected" : ""}>💡 创作价值 ↓</option>
              <option value="velocity_desc" ${state.explorerSort === "velocity_desc" ? "selected" : ""}>🚀 攀升速度 ↓</option>
              <option value="platform_desc" ${state.explorerSort === "platform_desc" ? "selected" : ""}>📊 平台数 ↓</option>
              <option value="duration_desc" ${state.explorerSort === "duration_desc" ? "selected" : ""}>⏱️ 持续时间 ↓</option>
            </select>
          </label>
          ${topics.length > 0 ? `
            <label class="trend-intel-filter-select-label">
              <span>赛道：</span>
              <select class="trend-intel-select" onchange="window.__trendIntelSetExplorerTopic(this.value)">
                <option value="all">全部赛道</option>
                ${topics.map(t => `<option value="${escapeHtml(t.id)}" ${state.explorerTopic === t.id ? "selected" : ""}>${t.icon} ${escapeHtml(t.name)}</option>`).join("")}
              </select>
            </label>
          ` : ""}
          <button class="btn btn-sm" onclick="window.__trendIntelLoadEvents()">
            🔄 刷新大盘
          </button>
        </div>
      </div>

      <!-- State Pills -->
      <div class="trend-intel-platform-pills">
        ${states.map(s => `
          <button 
            class="trend-intel-pill ${state.explorerState === s.id ? "active" : ""}" 
            onclick="window.__trendIntelSetExplorerState('${s.id}')">
            ${escapeHtml(s.label)}
          </button>
        `).join("")}
      </div>

      <!-- Events Grid -->
      ${state.eventsLoading ? `
        <div class="trend-intel-loading-box">
          <div class="trend-intel-spinner"></div>
          <p>正在计算趋势大盘事件…</p>
        </div>
      ` : (filtered.length === 0 ? `
        <div class="trend-intel-empty-box">
          <div class="trend-intel-empty-icon">📈</div>
          <h3>暂无符合筛选的趋势事件</h3>
          <p>当前筛选条件下无事件。请尝试切换生命周期状态或点击生成简报以刷新聚类。</p>
        </div>
      ` : `
        <div class="trend-intel-events-grid">
          ${filtered.map(evt => {
            const traj = state.expandedTrajectories[evt.event_id];
            const stateClass = `state-${evt.trend_state.toLowerCase()}`;
            const velText = evt.velocity > 0 ? `+${evt.velocity}` : `${evt.velocity}`;

            return `
              <div class="trend-intel-event-card ${stateClass}">
                <div class="trend-intel-event-top">
                  <div class="trend-intel-event-badge-row">
                    <span class="trend-intel-state-badge ${stateClass}">${evt.trend_state}</span>
                    <span class="trend-intel-velocity-badge">🚀 速度: ${velText} 排名/时</span>
                    ${evt.matched_topic ? `<span class="trend-intel-topic-badge">🎯 ${escapeHtml(evt.matched_topic)}</span>` : ""}
                  </div>
                  <h4 class="trend-intel-event-title">${escapeHtml(evt.title)}</h4>
                </div>

                <div class="trend-intel-score-bars">
                  <div class="trend-intel-score-item">
                    <div class="trend-intel-score-meta">
                      <span>🌐 世界重要度</span>
                      <strong>${evt.world_importance_score !== null ? evt.world_importance_score : "-"}/10</strong>
                    </div>
                    <div class="trend-intel-progress-bar">
                      <div class="trend-intel-progress-fill world-fill" style="width: ${Math.min(100, ((evt.world_importance_score || 0) / 10) * 100)}%;"></div>
                    </div>
                  </div>
                  <div class="trend-intel-score-item">
                    <div class="trend-intel-score-meta">
                      <span>💡 创作者价值</span>
                      <strong>${evt.creator_value_score !== null ? evt.creator_value_score : "-"}/10</strong>
                    </div>
                    <div class="trend-intel-progress-bar">
                      <div class="trend-intel-progress-fill creator-fill" style="width: ${Math.min(100, ((evt.creator_value_score || 0) / 10) * 100)}%;"></div>
                    </div>
                  </div>
                </div>

                <p class="trend-intel-event-summary">${escapeHtml(evt.summary || evt.title)}</p>

                <div class="trend-intel-event-meta-row">
                  <span>📊 覆盖平台: <strong>${(evt.platforms || []).map(p => PLATFORM_INFO[p]?.name || p).join(", ") || "全网"}</strong></span>
                  <span>⏱️ 持续: <strong>${evt.duration_hours || 0} 小时 (${evt.snapshot_count || 1} 次采样)</strong></span>
                </div>

                ${Array.isArray(evt.creator_angles) && evt.creator_angles.length > 0 ? `
                  <div class="trend-intel-angles-box">
                    <div class="trend-intel-angles-title">🎯 推荐创作切入角度：</div>
                    <ul class="trend-intel-angles-list">
                      ${evt.creator_angles.map(a => `<li>${escapeHtml(a)}</li>`).join("")}
                    </ul>
                  </div>
                ` : ""}

                <div class="trend-intel-event-actions">
                  <button class="btn btn-xs" onclick="window.__trendIntelToggleTrajectory('${escapeHtml(evt.event_id)}')">
                    📊 ${traj && traj.snapshots ? "收起轨迹" : "查看排名轨迹"}
                  </button>
                  <button class="btn btn-xs btn-primary" onclick="window.__trendIntelIdeateEvent('${escapeHtml(evt.event_id)}')">
                    💡 让AI构思选题
                  </button>
                </div>

                <!-- Trajectory Drawer / Inline Details -->
                ${traj ? `
                  <div class="trend-intel-trajectory-box">
                    ${traj.loading ? `
                      <div class="trend-intel-spinner sm"></div> 正在加载历史采样轨迹…
                    ` : (traj.error ? `
                      <span class="text-danger">${escapeHtml(traj.error)}</span>
                    ` : (traj.snapshots && traj.snapshots.length > 0 ? `
                      <div class="trend-intel-trajectory-timeline">
                        <div class="trend-intel-traj-header">
                          <span>采样历史 (${traj.snapshots.length} 次采样)</span>
                          <span class="trend-intel-traj-path">
                            ${traj.snapshots.map(s => `#${s.rank}`).join(" ➔ ")}
                          </span>
                        </div>
                        <div class="trend-intel-traj-items">
                          ${traj.snapshots.map(s => {
                            const timeStr = new Date(s.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                            const platInfo = PLATFORM_INFO[s.platform] || { name: s.platform, icon: "📌" };
                            return `
                              <div class="trend-intel-traj-node">
                                <span class="trend-intel-traj-rank">#${s.rank}</span>
                                <span class="trend-intel-traj-time">${timeStr}</span>
                                <span class="trend-intel-traj-plat">${platInfo.icon} ${escapeHtml(platInfo.name)}</span>
                              </div>
                            `;
                          }).join("")}
                        </div>
                      </div>
                    ` : `
                      <span class="text-muted">暂无更早历史采样记录</span>
                    `))}
                  </div>
                ` : ""}
              </div>
            `;
          }).join("")}
        </div>
      `)}
    </div>
  `;
}

function extractEndpointModels(ep: any): string[] {
  if (!ep) return [];
  const list = new Set<string>();
  // 1. Direct exposed models in models array
  if (Array.isArray(ep.models)) {
    ep.models.forEach((m: any) => {
      if (typeof m === "string" && m.trim()) list.add(m.trim());
    });
  }
  // 2. Public client-facing mapping keys (e.g. glm-5.3-zp)
  if (ep.model_mapping && typeof ep.model_mapping === "object") {
    Object.keys(ep.model_mapping).forEach(k => {
      if (typeof k === "string" && k.trim()) list.add(k.trim());
    });
  }
  // 3. Fallback to model/default_model only if no models or mapping keys
  if (list.size === 0) {
    if (typeof ep.model === "string" && ep.model.trim()) list.add(ep.model.trim());
    if (typeof ep.default_model === "string" && ep.default_model.trim()) list.add(ep.default_model.trim());
  }
  return Array.from(list);
}

// --- Sub-View 4: Settings ---

function renderSettingsView(): string {
  const d = state.configDraft;
  if (!d) {
    return `<div class="trend-intel-loading-box"><div class="trend-intel-spinner"></div><p>正在加载配置…</p></div>`;
  }

  const platforms = Object.entries(PLATFORM_INFO);
  const clients = Object.keys(state.gatewayConfig?.clients || { codex: {}, code: {}, desktop: {}, deeptutor: {} });
  const selectedClient = d.model_route?.client || (clients[0] || "codex");
  const endpoints = state.gatewayConfig?.clients?.[selectedClient]?.endpoints || [];
  const selectedEpIndex = Math.min(endpoints.length - 1, Math.max(0, d.model_route?.endpoint_index || 0));
  const currentEndpoint = endpoints[selectedEpIndex];
  const endpointModels: string[] = extractEndpointModels(currentEndpoint);

  return `
    <div class="trend-intel-view trend-intel-settings-view">
      <div class="trend-intel-settings-header">
        <div>
          <h3>热点情报与趋势雷达配置</h3>
          <p>配置自动抓取周期、数据源平台、动态重点赛道专栏以及 3 级级联 AI 模型路由。</p>
        </div>
        <div class="trend-intel-settings-actions">
          <button class="btn btn-sm" onclick="window.__trendIntelResetSettings()" ${state.saving ? "disabled" : ""}>
            恢复默认
          </button>
          <button class="btn btn-sm btn-primary" onclick="window.__trendIntelSaveSettings()" ${state.saving ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            ${state.saving ? "保存中…" : "保存模块配置"}
          </button>
        </div>
      </div>

      <div class="trend-intel-settings-grid">
        <!-- 1. Scheduler -->
        <div class="card">
          <div class="card-header">
            <h4>⏰ 定时抓取与简报调度 (Scheduler)</h4>
          </div>
          <div class="form-grid">
            <div class="form-group full">
              <label class="trend-intel-switch-label">
                <span class="trend-intel-switch">
                  <input 
                    type="checkbox" 
                    ${d.scheduler.enabled ? "checked" : ""} 
                    onchange="window.__trendIntelUpdateDraft('scheduler.enabled', this.checked)" />
                  <span class="trend-intel-switch-track" aria-hidden="true"></span>
                </span>
                <span class="trend-intel-switch-text">启用后台定时监控抓取与自动简报调度</span>
              </label>
            </div>
            <div class="form-group">
              <label>抓取监控间隔 (分钟)</label>
              <input 
                type="number" 
                min="5" 
                max="360" 
                value="${d.scheduler.interval_minutes}" 
                onchange="window.__trendIntelUpdateDraft('scheduler.interval_minutes', Number(this.value) || 30)" />
            </div>
            <div class="form-group">
              <label>每日简报自动生成时间 (逗号分隔)</label>
              <input 
                type="text" 
                value="${escapeHtml((d.scheduler.daily_brief_times || []).join(', '))}" 
                placeholder="08:30, 18:00"
                onchange="window.__trendIntelUpdateDraft('scheduler.daily_brief_times', this.value.split(',').map(s => s.trim()).filter(Boolean))" />
            </div>
          </div>
        </div>

        <!-- 2. Platforms -->
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
            <h4>🌐 平台数据源启用 (Platforms)</h4>
            <div>
              <button class="btn btn-xs" onclick="window.__trendIntelToggleAllPlatforms(true)">全选</button>
              <button class="btn btn-xs" onclick="window.__trendIntelToggleAllPlatforms(false)">全部取消</button>
            </div>
          </div>
          <div class="trend-intel-platforms-grid">
            ${platforms.map(([id, info]) => {
              const checked = d.platforms?.[id] !== false;
              return `
                <div class="trend-intel-platform-item ${checked ? "active" : ""}">
                  <div class="trend-intel-platform-info">
                    <span class="platform-icon">${info.icon}</span>
                    <span class="platform-name">${escapeHtml(info.name)}</span>
                  </div>
                  <label class="trend-intel-switch" title="启用/停用 ${escapeHtml(info.name)}">
                    <input 
                      type="checkbox" 
                      ${checked ? "checked" : ""} 
                      onchange="window.__trendIntelUpdateDraft('platforms.${id}', this.checked)" />
                    <span class="trend-intel-switch-track" aria-hidden="true"></span>
                  </label>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <!-- 3. Dynamic Focus Topics Manager (Zero Hardcoding!) -->
        <div class="card trend-intel-focus-topics-card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <h4>🎯 动态重点赛道管理 (Dynamic Focus Topics)</h4>
              <p style="margin:0; font-size:12px; color:var(--text-secondary);">完全由用户动态增删改，自动在简报中产出垂直赛道专栏。</p>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="btn btn-sm" onclick="window.__trendIntelAddFocusTopic()">
                + 添加空白赛道
              </button>
              <button class="btn btn-sm btn-primary" onclick="window.__trendIntelSaveSettings()" ${state.saving ? "disabled" : ""}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                ${state.saving ? "保存中…" : "保存赛道配置"}
              </button>
            </div>
          </div>

          <!-- Presets Quick Bar -->
          <div class="trend-intel-presets-bar">
            <div class="presets-label">
              <span>⚡ 一键快速添加预设赛道：</span>
            </div>
            <div class="presets-buttons">
              ${TOPIC_PRESETS.map((p, pIdx) => `
                <button class="btn btn-xs preset-btn" onclick="window.__trendIntelAddTopicFromPreset(${pIdx})" title="一键导入「${escapeHtml(p.name)}」模板">
                  <span>${p.icon} + ${escapeHtml(p.name)}</span>
                </button>
              `).join("")}
            </div>
          </div>

          <div class="trend-intel-topics-list">
            ${(d.focus_topics || []).length === 0 ? `
              <div class="trend-intel-empty-topics">
                <p>暂无自定义赛道。你可以点击上方按钮一键添加行业预设模板，或点击右上角添加空白赛道。</p>
              </div>
            ` : d.focus_topics.map((topic, idx) => {
              const keywords = topic.keywords || [];
              const rssSources = topic.rss_sources || [];
              const isEnabled = topic.enabled !== false;

              return `
                <div class="trend-intel-topic-item-card ${isEnabled ? "enabled" : "disabled"}">
                  <!-- Header: Emoji, Name, Switch, Delete -->
                  <div class="trend-intel-topic-item-top">
                    <div class="topic-emoji-selector-wrap">
                      <button class="topic-emoji-btn" onclick="window.__trendIntelToggleEmojiPicker(${idx})" title="切换图标 Emoji">
                        <span>${escapeHtml(topic.icon || "📌")}</span>
                        <span class="emoji-arrow">▾</span>
                      </button>
                      <div class="topic-emoji-palette" id="topic-emoji-palette-${idx}" style="display:none;">
                        ${COMMON_EMOJIS.map(em => `
                          <button class="emoji-chip" onclick="window.__trendIntelSelectEmoji(${idx}, '${em}')">${em}</button>
                        `).join("")}
                      </div>
                    </div>

                    <input 
                      type="text" 
                      class="trend-intel-topic-name-input" 
                      value="${escapeHtml(topic.name || "")}" 
                      placeholder="赛道名称 (如: 人工智能与前沿科技)" 
                      onchange="window.__trendIntelUpdateTopic(${idx}, 'name', this.value)" />

                    <span class="topic-stat-badge">${keywords.length} 关键词</span>
                    ${rssSources.length > 0 ? `<span class="topic-stat-badge rss">${rssSources.length} 订阅源</span>` : ""}

                    <label class="trend-intel-switch" title="启用/停用该赛道" style="display:inline-flex; align-items:center; gap:6px;">
                      <input 
                        type="checkbox" 
                        ${isEnabled ? "checked" : ""} 
                        onchange="window.__trendIntelUpdateTopic(${idx}, 'enabled', this.checked)" />
                      <span class="trend-intel-switch-track" aria-hidden="true"></span>
                      <span style="font-size:12px; color:var(--text-secondary); font-weight:500;">${isEnabled ? "已启用" : "已停用"}</span>
                    </label>

                    <button class="btn btn-xs text-danger" onclick="window.__trendIntelRemoveFocusTopic(${idx})" title="删除赛道">
                      🗑️ 删除
                    </button>
                  </div>

                  <!-- Field 1: Keywords Chips -->
                  <div class="topic-field-block">
                    <div class="topic-field-meta">
                      <span class="topic-field-title">🏷️ 监控关键词 (${keywords.length})：</span>
                      <span class="topic-field-hint">输入词后按回车/逗号自动添加</span>
                    </div>
                    <div class="topic-chips-container">
                      ${keywords.map((kw, kwIdx) => `
                        <span class="topic-tag-chip">
                          <span class="chip-text">${escapeHtml(kw)}</span>
                          <button class="chip-del-btn" onclick="window.__trendIntelRemoveKeywordFromTopic(${idx}, ${kwIdx})" title="删除">✕</button>
                        </span>
                      `).join("")}
                      <input 
                        type="text" 
                        class="topic-inline-tag-input" 
                        placeholder="+ 输入关键词回车添加..." 
                        onkeydown="if(event.key === 'Enter' || event.key === ',' || event.key === '，'){ event.preventDefault(); window.__trendIntelAddKeywordFromInput(${idx}, this); }"
                        onblur="if(this.value.trim()){ window.__trendIntelAddKeywordFromInput(${idx}, this); }" />
                    </div>
                  </div>

                  <!-- Field 2: RSS Feeds Chips -->
                  <div class="topic-field-block">
                    <div class="topic-field-meta">
                      <span class="topic-field-title">📡 专属 RSS 订阅源 (${rssSources.length})：</span>
                      <span class="topic-field-hint">可选，抓取时将额外摄取该源资讯</span>
                    </div>
                    <div class="topic-chips-container rss-container">
                      ${rssSources.map((rss, rssIdx) => `
                        <span class="topic-tag-chip rss-tag-chip">
                          <span class="chip-text" title="${escapeHtml(rss)}">${escapeHtml(rss)}</span>
                          <button class="chip-del-btn" onclick="window.__trendIntelRemoveRssFromTopic(${idx}, ${rssIdx})" title="删除">✕</button>
                        </span>
                      `).join("")}
                      <input 
                        type="text" 
                        class="topic-inline-tag-input rss-input" 
                        placeholder="+ 输入 RSS 地址 (https://...) 回车添加..." 
                        onkeydown="if(event.key === 'Enter'){ event.preventDefault(); window.__trendIntelAddRssFromInput(${idx}, this); }"
                        onblur="if(this.value.trim()){ window.__trendIntelAddRssFromInput(${idx}, this); }" />
                    </div>

                    <div class="curated-rss-bar">
                      <span class="curated-label">推荐订阅源快捷添加：</span>
                      ${RECOMMENDED_RSS_SOURCES.map(r => `
                        <button class="btn btn-xs curated-btn" onclick="window.__trendIntelAddRssToTopic(${idx}, '${r.url}')" title="添加 ${escapeHtml(r.name)} (${escapeHtml(r.url)})">
                          <span>${r.icon} + ${escapeHtml(r.name)}</span>
                        </button>
                      `).join("")}
                    </div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <!-- 3.5. 极客资讯订阅源管理 (Geek Feeds) -->
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <h4>📡 极客资讯订阅源管理 (Geek Feeds - RSS / 独立社区)</h4>
              <p style="margin:0; font-size:12px; color:var(--text-secondary);">配置纯文本速览与抓取的技术社区、论坛或博客 RSS/Atom 订阅源，支持一键增删改查与启停。</p>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="btn btn-sm btn-primary" onclick="window.__trendIntelSaveSettings()" ${state.saving ? "disabled" : ""}>
                ${state.saving ? "保存中…" : "保存订阅配置"}
              </button>
            </div>
          </div>

          <!-- Presets Quick Bar for Geek Feeds -->
          <div class="trend-intel-presets-bar">
            <div class="presets-label">
              <span>⚡ 常用极客社区预设一键导入：</span>
            </div>
            <div class="presets-buttons">
              <button class="btn btn-xs preset-btn" onclick="window.__trendIntelAddGeekFeedPreset('linux_do')">🐧 + LINUX DO (每日热门)</button>
              <button class="btn btn-xs preset-btn" onclick="window.__trendIntelAddGeekFeedPreset('v2ex')">💻 + V2EX (技术热议)</button>
              <button class="btn btn-xs preset-btn" onclick="window.__trendIntelAddGeekFeedPreset('36kr')">⚡ + 36氪 (快讯)</button>
              <button class="btn btn-xs preset-btn" onclick="window.__trendIntelAddGeekFeedPreset('sspai')">📱 + 少数派 (深度博客)</button>
            </div>
          </div>

          <!-- Feeds List -->
          <div class="trend-intel-geek-feeds-list">
            ${(d.geek_feeds || []).length === 0 ? `
              <div class="trend-intel-empty-topics">
                <p>暂无订阅源，可点击上方快捷导入，或在下方添加自定义 RSS 地址。</p>
              </div>
            ` : (d.geek_feeds || []).map((feed, fIdx) => `
              <div class="geek-feed-setting-row ${feed.enabled !== false ? "enabled" : "disabled"}">
                <div class="geek-feed-main-line">
                  <input 
                    type="text" 
                    value="${escapeHtml(feed.icon || "💻")}" 
                    style="width: 44px; text-align: center;" 
                    placeholder="图标"
                    title="图标"
                    onchange="window.__trendIntelUpdateGeekFeed(${fIdx}, 'icon', this.value)" />
                  <input 
                    type="text" 
                    value="${escapeHtml(feed.name || "")}" 
                    style="width: 170px;" 
                    placeholder="订阅源名称"
                    title="订阅源名称"
                    onchange="window.__trendIntelUpdateGeekFeed(${fIdx}, 'name', this.value)" />
                  <input 
                    type="text" 
                    value="${escapeHtml(feed.url || "")}" 
                    style="flex: 1; min-width: 220px; font-family: monospace; font-size: 12px;" 
                    placeholder="RSS / Atom 地址 (https://...)"
                    title="订阅源 URL"
                    onchange="window.__trendIntelUpdateGeekFeed(${fIdx}, 'url', this.value)" />
                  <label class="trend-intel-switch" title="启用/停用该订阅源">
                    <input 
                      type="checkbox" 
                      ${feed.enabled !== false ? "checked" : ""} 
                      onchange="window.__trendIntelUpdateGeekFeed(${fIdx}, 'enabled', this.checked)" />
                    <span class="trend-intel-switch-track" aria-hidden="true"></span>
                  </label>
                  <button class="btn btn-xs text-danger" onclick="window.__trendIntelRemoveGeekFeed(${fIdx})" title="删除此订阅源">
                    🗑️
                  </button>
                </div>
                <div class="geek-feed-cookie-line">
                  <span class="cookie-label">🍪 访问 Cookie (可选，用于绕过 Cloudflare 5秒盾/登录)：</span>
                  <input 
                    type="password" 
                    value="${escapeHtml(feed.cookie || "")}" 
                    placeholder="如: cf_clearance=...; _t=..." 
                    title="设置请求该源时携带的 Cookie"
                    onchange="window.__trendIntelUpdateGeekFeed(${fIdx}, 'cookie', this.value)" />
                  ${feed.cookie ? `
                    <button class="btn btn-xs" onclick="window.__trendIntelUpdateGeekFeed(${fIdx}, 'cookie', '')" title="清空 Cookie">
                      清空
                    </button>
                  ` : ""}
                </div>
              </div>
            `).join("")}

            <!-- Add Custom Feed Inline Form -->
            <div class="geek-feed-add-form">
              <input type="text" id="new-geek-feed-icon" placeholder="图标" value="📰" style="width:44px; text-align:center;" />
              <input type="text" id="new-geek-feed-name" placeholder="订阅源名称 (如: 某技术博客)" style="width:170px;" />
              <input type="text" id="new-geek-feed-url" placeholder="RSS 地址 (https://...)" style="flex:1; min-width: 220px; font-family: monospace; font-size: 12px;" />
              <button class="btn btn-sm" onclick="window.__trendIntelAddCustomGeekFeed()">
                + 添加订阅源
              </button>
            </div>
          </div>
        </div>

        <!-- 4. 3-Tier Cascaded Model Selector -->
        <div class="card">
          <div class="card-header">
            <h4>🤖 3 级级联 AI 模型选择 (3-Tier Model Selector)</h4>
            <p style="margin:0; font-size:12px; color:var(--text-secondary);">用于简报摘要、世界重要度与创作者价值的 AI 分析路由。</p>
          </div>
          <div class="form-grid">
            <!-- Tier 1: Client -->
            <div class="form-group">
              <label>1. 目标客户端 (Client)</label>
              <select class="trend-intel-select" onchange="window.__trendIntelSelectModelClient(this.value)">
                ${clients.map(c => `<option value="${escapeHtml(c)}" ${selectedClient === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
              </select>
            </div>
            <!-- Tier 2: Endpoint -->
            <div class="form-group">
              <label>2. 代理服务节点 (Endpoint)</label>
              <select class="trend-intel-select" onchange="window.__trendIntelSelectModelEndpoint(Number(this.value))">
                ${endpoints.length === 0 ? `<option value="0">默认节点 (无配置节点)</option>` : endpoints.map((ep: any, epIdx: number) => `
                  <option value="${epIdx}" ${selectedEpIndex === epIdx ? "selected" : ""}>
                    节点 ${epIdx}: ${escapeHtml(ep.name || ep.type || "Unnamed")} (${escapeHtml(ep.type || "endpoint")})
                  </option>
                `).join("")}
              </select>
            </div>
            <!-- Tier 3: Model -->
            <div class="form-group full">
              <label>3. 生效模型 (Model)</label>
              <div style="display:flex; gap:8px;">
                <select class="trend-intel-select" style="flex:1;" onchange="window.__trendIntelSelectModel(this.value)">
                  <option value="">跟随节点默认模型</option>
                  ${endpointModels.map(m => `<option value="${escapeHtml(m)}" ${d.model_route?.model === m ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")}
                </select>
                <input 
                  type="text" 
                  style="flex:1;" 
                  placeholder="或手动输入自定义模型名" 
                  value="${escapeHtml(d.model_route?.model || "")}" 
                  oninput="window.__trendIntelSelectModel(this.value)" />
              </div>
            </div>
          </div>
        </div>

        <!-- 5. Proxy & Paths -->
        <div class="card">
          <div class="card-header">
            <h4>🌐 网络代理与数据目录 (Proxy & Storage)</h4>
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label>网络代理模式</label>
              <select 
                class="trend-intel-select" 
                value="${escapeHtml(d.proxy?.mode || "inherit")}" 
                onchange="window.__trendIntelUpdateDraft('proxy.mode', this.value)">
                <option value="inherit" ${d.proxy?.mode === "inherit" ? "selected" : ""}>跟随网关代理 (Inherit)</option>
                <option value="direct" ${d.proxy?.mode === "direct" ? "selected" : ""}>直连网络 (Direct)</option>
                <option value="custom" ${d.proxy?.mode === "custom" ? "selected" : ""}>自定义代理地址 (Custom)</option>
              </select>
            </div>
            <div class="form-group">
              <label>自定义代理 URL</label>
              <input 
                type="text" 
                placeholder="http://127.0.0.1:7890" 
                value="${escapeHtml(d.proxy?.custom_url || "")}" 
                ${d.proxy?.mode !== "custom" ? "disabled" : ""}
                onchange="window.__trendIntelUpdateDraft('proxy.custom_url', this.value)" />
            </div>
            <div class="form-group full">
              <label>数据持久化目录</label>
              <input 
                type="text" 
                readonly 
                class="mono" 
                value="${escapeHtml(d.data_dir || "output/trend-intel 或 ~/.shrimp/trend-intel")}" />
            </div>
          </div>
        </div>
      </div>

      <!-- Settings Bottom Save Action Bar -->
      <div class="trend-intel-settings-bottom-bar">
        <div class="bottom-bar-hint">
          <span>💡 提示：修改赛道关键词、数据源或模型路由后，请点击右侧按钮保存生效。</span>
        </div>
        <div class="bottom-bar-actions">
          <button class="btn btn-sm" onclick="window.__trendIntelResetSettings()" ${state.saving ? "disabled" : ""}>
            重置修改
          </button>
          <button class="btn btn-sm btn-primary" onclick="window.__trendIntelSaveSettings()" ${state.saving ? "disabled" : ""}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            ${state.saving ? "保存中…" : "立即保存所有配置"}
          </button>
        </div>
      </div>
    </div>
  `;
}

// --- Main Render Function ---

export function render(): void {
  const el = rootEl();
  if (!el) return;

  let body = "";
  switch (state.activeView) {
    case "brief":
      body = renderBriefView();
      break;
    case "geek":
      body = renderGeekFeedsView();
      break;
    case "raw":
      body = renderRawFeedsView();
      break;
    case "explorer":
      body = renderTrendExplorerView();
      break;
    case "settings":
      body = renderSettingsView();
      break;
  }

  el.innerHTML = `
    <div class="trend-intel-root-wrap">
      ${renderHeaderNav()}
      ${state.error ? `
        <div class="trend-intel-alert-banner">
          <span>⚠️ ${escapeHtml(state.error)}</span>
          <button onclick="window.__trendIntelClearError()">✕</button>
        </div>
      ` : ""}
      <div class="trend-intel-body">
        ${body}
      </div>
    </div>
  `;
}

// --- Window Action Bindings ---

export function initTrendIntel(): void {
  void loadConfig();
  void loadBrief();
  void loadGeekItems("all");
}

(window as any).__trendIntelSwitchView = (view: SubView) => {
  state.activeView = view;
  state.error = "";
  if (view === "brief" && !state.brief) void loadBrief();
  if (view === "geek" && state.geekItems.length === 0) void loadGeekItems("all");
  if (view === "raw" && state.rawItems.length === 0) void loadRawItems();
  if (view === "explorer" && state.events.length === 0) void loadEvents();
  if (view === "settings") void loadConfig();
  render();
};

(window as any).__trendIntelSetGeekPlatform = (platform: string) => {
  state.geekPlatform = platform;
  render();
};

(window as any).__trendIntelSearchGeek = (query: string) => {
  state.geekSearch = query;
  render();
};

(window as any).__trendIntelToggleStealth = () => {
  state.geekStealthMode = !state.geekStealthMode;
  render();
};

(window as any).__trendIntelRefreshGeek = async () => {
  const linuxDoFeed = state.geekFeeds?.find(f => f.id === "linux_do");
  if (state.geekPlatform === "linux_do" && !linuxDoFeed?.cookie) {
    showToast("🐧 LINUX DO 尚未配置访客凭证 (cf_clearance)，请在下方输入框粘贴凭证保存！", "warning");
    return;
  }

  state.geekLoading = true;
  render();
  try {
    showToast("正在拉取最新极客订阅源…", "info");
    await triggerCrawl();
    await loadGeekItems("all");
    showToast("极客订阅源刷新完成！", "success");
  } catch (err: any) {
    showToast(`刷新失败: ${err?.message || err}`, "error");
  } finally {
    state.geekLoading = false;
    render();
  }
};

(window as any).__trendIntelQuickSaveCookie = async (feedId: string) => {
  const input = document.getElementById(`quick-feed-cookie-${feedId}`) as HTMLInputElement;
  let cookieVal = input ? input.value.trim() : "";
  if (!cookieVal) {
    showToast("请输入有效 Cookie 凭证 (例如: cf_clearance=...)", "warning");
    return;
  }

  // 自动为纯 token 补齐键名
  if (!cookieVal.includes("=")) {
    cookieVal = `cf_clearance=${cookieVal}`;
  }

  if (!state.configDraft) {
    await loadConfig();
  }
  if (!state.configDraft) return;

  state.configDraft.geek_feeds = state.configDraft.geek_feeds || [];
  let feed = state.configDraft.geek_feeds.find(f => f.id === feedId);
  if (!feed) {
    feed = {
      id: feedId,
      name: feedId === "linux_do" ? "LINUX DO 每日热榜" : feedId,
      icon: feedId === "linux_do" ? "🐧" : "💻",
      url: feedId === "linux_do" ? "https://linux.do/top/daily.rss" : "",
      enabled: true,
      category: "community",
      cookie: cookieVal
    };
    state.configDraft.geek_feeds.push(feed);
  } else {
    feed.cookie = cookieVal;
  }

  showToast("正在保存 Cookie 并尝试重新抓取…", "info");
  try {
    await saveSettings();
    await triggerCrawl();
    await loadGeekItems("all");
    showToast("Cookie 保存并重新抓取完成！", "success");
  } catch (err: any) {
    showToast(`操作失败: ${err?.message || err}`, "error");
  }
};

(window as any).__trendIntelCopySyncScript = () => {
  const code = `fetch('/top.json').then(r=>r.json()).then(d=>fetch('http://127.0.0.1:8787/v1/trend-intel/ingest-geek',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform:'linux_do',items:d.topic_list.topics})})).then(r=>r.json()).then(r=>alert('🎉 成功同步 '+r.count+' 篇 LINUX DO 热门到网关！')).catch(e=>alert('同步失败:'+e.message));`;
  copyText(code, "已复制 1 键同步脚本！在 linux.do 网页按 F12 ➔ 控制台 (Console) 粘贴回车即可！");
};

(window as any).__trendIntelSummarizeGeekItem = (itemId: string) => {
  void triggerSummarizeGeekItem(itemId);
};

(window as any).__trendIntelCopyUrl = (url: string) => {
  if (url) copyText(url, "已复制文章链接到剪贴板！");
};

(window as any).__trendIntelUpdateGeekFeed = (idx: number, field: string, val: any) => {
  if (!state.configDraft?.geek_feeds?.[idx]) return;
  (state.configDraft.geek_feeds[idx] as any)[field] = val;
  render();
};

(window as any).__trendIntelRemoveGeekFeed = (idx: number) => {
  if (!state.configDraft?.geek_feeds) return;
  state.configDraft.geek_feeds.splice(idx, 1);
  render();
};

(window as any).__trendIntelAddGeekFeedPreset = (presetKey: string) => {
  if (!state.configDraft) return;
  state.configDraft.geek_feeds = state.configDraft.geek_feeds || [];
  const preset = RECOMMENDED_RSS_SOURCES.find(r => r.name.toLowerCase().includes(presetKey) || r.url.includes(presetKey));
  if (!preset) return;

  const exists = state.configDraft.geek_feeds.some(f => f.url === preset.url);
  if (exists) {
    showToast(`订阅源「${preset.name}」已存在`, "info");
    return;
  }

  const id = presetKey === "linux_do" ? "linux_do" : (presetKey === "v2ex" ? "v2ex" : `feed_${Date.now()}`);
  state.configDraft.geek_feeds.push({
    id,
    name: preset.name,
    icon: preset.icon,
    url: preset.url,
    enabled: true,
    category: "tech"
  });
  render();
  showToast(`已添加「${preset.name}」到订阅列表`, "info");
};

(window as any).__trendIntelAddCustomGeekFeed = () => {
  if (!state.configDraft) return;
  const iconInput = document.getElementById("new-geek-feed-icon") as HTMLInputElement;
  const nameInput = document.getElementById("new-geek-feed-name") as HTMLInputElement;
  const urlInput = document.getElementById("new-geek-feed-url") as HTMLInputElement;

  const icon = iconInput?.value?.trim() || "📰";
  const name = nameInput?.value?.trim();
  const url = urlInput?.value?.trim();

  if (!name || !url) {
    showToast("请输入订阅源名称和有效的 RSS 地址", "warning");
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    showToast("订阅源地址必须以 http:// 或 https:// 开头", "warning");
    return;
  }

  state.configDraft.geek_feeds = state.configDraft.geek_feeds || [];
  state.configDraft.geek_feeds.push({
    id: `custom_${Date.now()}`,
    name,
    icon,
    url,
    enabled: true,
    category: "custom"
  });

  if (nameInput) nameInput.value = "";
  if (urlInput) urlInput.value = "";
  render();
  showToast(`已添加自定义订阅源「${name}」`, "success");
};

(window as any).__trendIntelChangeDate = (date: string) => {
  void loadBrief(date);
};

(window as any).__trendIntelQuickDate = (which: "today" | "yesterday") => {
  const d = new Date();
  if (which === "yesterday") d.setDate(d.getDate() - 1);
  const dateStr = d.toISOString().slice(0, 10);
  void loadBrief(dateStr);
};

(window as any).__trendIntelCrawl = () => {
  void triggerCrawl();
};

(window as any).__trendIntelGenerateBrief = () => {
  void triggerGenerateBrief();
};

(window as any).__trendIntelCopyBriefMarkdown = () => {
  if (state.brief?.markdown) {
    copyText(state.brief.markdown, "已复制简报 Markdown 到剪贴板！");
  }
};

(window as any).__trendIntelSwitchBriefMode = (mode: "cards" | "markdown") => {
  state.briefViewMode = mode;
  render();
};

(window as any).__trendIntelSetRawPlatform = (platform: string) => {
  state.rawPlatform = platform;
  void loadRawItems();
};

(window as any).__trendIntelSearchRaw = (query: string) => {
  state.rawSearch = query;
  render();
};

(window as any).__trendIntelAnalyzeRaw = (title: string, platform: string, rank: number, hotValue: string) => {
  copyRawAnalyzePrompt(title, platform, rank, hotValue);
};

(window as any).__trendIntelSetExplorerState = (st: string) => {
  state.explorerState = st;
  void loadEvents();
};

(window as any).__trendIntelSetExplorerSort = (sortBy: string) => {
  state.explorerSort = sortBy;
  render();
};

(window as any).__trendIntelSetExplorerTopic = (topicId: string) => {
  state.explorerTopic = topicId;
  void loadEvents();
};

(window as any).__trendIntelSearchExplorer = (query: string) => {
  state.explorerSearch = query;
  render();
};

(window as any).__trendIntelLoadEvents = () => {
  void loadEvents();
};

(window as any).__trendIntelToggleTrajectory = (eventId: string) => {
  void toggleTrajectory(eventId);
};

(window as any).__trendIntelIdeateEvent = (eventId: string) => {
  const evt = state.events.find(e => e.event_id === eventId);
  if (evt) copyEventIdeatePrompt(evt);
};

(window as any).__trendIntelIdeateFromBrief = (title: string) => {
  const prompt = `请基于热点事件「${title}」进行爆款内容选题策划：
1. 3 套针对不同受众画像的爆款标题（悬念型、深度干货型、争议思辨型）；
2. 核心冲突与受众认知差分析（大众常规怎么看 vs 真正有价值的角度）；
3. 详尽的短视频/图文行文大纲（含开头黄金 3 秒钩子、中段论证逻辑与结尾金句）。`;
  copyText(prompt, `已复制「${title}」的选题策划提示词！`);
};

(window as any).__trendIntelUpdateDraft = (path: string, val: any) => {
  if (!state.configDraft) return;
  const parts = path.split(".");
  let cur: any = state.configDraft;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
  render();
};

(window as any).__trendIntelToggleAllPlatforms = (enableAll: boolean) => {
  if (!state.configDraft) return;
  state.configDraft.platforms = state.configDraft.platforms || {};
  for (const id of Object.keys(PLATFORM_INFO)) {
    state.configDraft.platforms[id] = enableAll;
  }
  render();
};

(window as any).__trendIntelAddFocusTopic = () => {
  if (!state.configDraft) return;
  state.configDraft.focus_topics = state.configDraft.focus_topics || [];
  state.configDraft.focus_topics.push({
    id: `topic_${Date.now()}`,
    name: "新赛道",
    icon: "📌",
    enabled: true,
    keywords: [],
    rss_sources: []
  });
  render();
};

(window as any).__trendIntelAddTopicFromPreset = (presetIdx: number) => {
  if (!state.configDraft) return;
  const p = TOPIC_PRESETS[presetIdx];
  if (!p) return;
  state.configDraft.focus_topics = state.configDraft.focus_topics || [];
  state.configDraft.focus_topics.push({
    id: `topic_${Date.now()}`,
    name: p.name,
    icon: p.icon,
    enabled: true,
    keywords: [...p.keywords],
    rss_sources: [...p.rss_sources]
  });
  render();
  showToast(`已添加「${p.name}」赛道模板`, "success");
};

(window as any).__trendIntelAddKeywordFromInput = (topicIdx: number, inputEl: HTMLInputElement) => {
  if (!state.configDraft?.focus_topics?.[topicIdx]) return;
  const val = inputEl.value.trim().replace(/^[,，\s]+|[,，\s]+$/g, "");
  if (!val) return;
  const topic = state.configDraft.focus_topics[topicIdx];
  topic.keywords = topic.keywords || [];
  const newKws = val.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  for (const kw of newKws) {
    if (!topic.keywords.includes(kw)) {
      topic.keywords.push(kw);
    }
  }
  inputEl.value = "";
  render();
};

(window as any).__trendIntelRemoveKeywordFromTopic = (topicIdx: number, kwIdx: number) => {
  if (!state.configDraft?.focus_topics?.[topicIdx]?.keywords) return;
  state.configDraft.focus_topics[topicIdx].keywords.splice(kwIdx, 1);
  render();
};

(window as any).__trendIntelAddRssFromInput = (topicIdx: number, inputEl: HTMLInputElement) => {
  if (!state.configDraft?.focus_topics?.[topicIdx]) return;
  const val = inputEl.value.trim();
  if (!val) return;
  const topic = state.configDraft.focus_topics[topicIdx];
  topic.rss_sources = topic.rss_sources || [];
  if (!topic.rss_sources.includes(val)) {
    topic.rss_sources.push(val);
  }
  inputEl.value = "";
  render();
};

(window as any).__trendIntelAddRssToTopic = (topicIdx: number, rssUrl: string) => {
  if (!state.configDraft?.focus_topics?.[topicIdx]) return;
  const topic = state.configDraft.focus_topics[topicIdx];
  topic.rss_sources = topic.rss_sources || [];
  if (!topic.rss_sources.includes(rssUrl)) {
    topic.rss_sources.push(rssUrl);
    render();
    showToast(`已添加订阅源 ${rssUrl}`, "info");
  } else {
    showToast("该订阅源已存在", "info");
  }
};

(window as any).__trendIntelRemoveRssFromTopic = (topicIdx: number, rssIdx: number) => {
  if (!state.configDraft?.focus_topics?.[topicIdx]?.rss_sources) return;
  state.configDraft.focus_topics[topicIdx].rss_sources.splice(rssIdx, 1);
  render();
};

(window as any).__trendIntelToggleEmojiPicker = (topicIdx: number) => {
  const palette = document.getElementById(`topic-emoji-palette-${topicIdx}`);
  if (palette) {
    palette.style.display = palette.style.display === "none" ? "flex" : "none";
  }
};

(window as any).__trendIntelSelectEmoji = (topicIdx: number, emoji: string) => {
  if (!state.configDraft?.focus_topics?.[topicIdx]) return;
  state.configDraft.focus_topics[topicIdx].icon = emoji;
  render();
};

(window as any).__trendIntelRemoveFocusTopic = (idx: number) => {
  if (!state.configDraft?.focus_topics) return;
  state.configDraft.focus_topics.splice(idx, 1);
  render();
};

(window as any).__trendIntelUpdateTopic = (idx: number, field: string, val: any) => {
  if (!state.configDraft?.focus_topics?.[idx]) return;
  (state.configDraft.focus_topics[idx] as any)[field] = val;
  render();
};

(window as any).__trendIntelSelectModelClient = (client: string) => {
  if (!state.configDraft) return;
  state.configDraft.model_route = state.configDraft.model_route || { client: "codex", endpoint_index: 0, model: "" };
  state.configDraft.model_route.client = client;
  state.configDraft.model_route.endpoint_index = 0;
  state.configDraft.model_route.model = "";
  render();
};

(window as any).__trendIntelSelectModelEndpoint = (epIdx: number) => {
  if (!state.configDraft) return;
  state.configDraft.model_route = state.configDraft.model_route || { client: "codex", endpoint_index: 0, model: "" };
  state.configDraft.model_route.endpoint_index = epIdx;
  state.configDraft.model_route.model = "";
  render();
};

(window as any).__trendIntelSelectModel = (model: string) => {
  if (!state.configDraft) return;
  state.configDraft.model_route = state.configDraft.model_route || { client: "codex", endpoint_index: 0, model: "" };
  state.configDraft.model_route.model = model;
  render();
};

(window as any).__trendIntelSaveSettings = () => {
  void saveSettings();
};

(window as any).__trendIntelResetSettings = () => {
  if (state.config) {
    state.configDraft = JSON.parse(JSON.stringify(state.config));
    render();
    showToast("已重置为生效配置", "info");
  }
};

(window as any).__trendIntelClearError = () => {
  state.error = "";
  render();
};

(window as any).__trendIntelOpenUrl = (url: string) => {
  if (url && typeof url === "string") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

// Register Tab Lifecycle
registerTab("trend-intel", {
  onEnter: () => {
    initTrendIntel();
  }
});
