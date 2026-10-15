export const SEED_BIG_TECH = [
  "阿里巴巴",
  "阿里",
  "淘宝",
  "天猫",
  "美团",
  "腾讯",
  "字节跳动",
  "字节",
  "快手",
  "百度",
  "京东",
  "拼多多",
  "网易",
  "滴滴",
  "蚂蚁集团",
  "蚂蚁",
  "小米",
  "华为",
  "微软",
  "亚马逊",
  "苹果",
  "apple",
  "特斯拉",
  "谷歌",
  "英伟达",
  "shopee",
  "ebay",
  "paypal",
];

export const SEED_MID_TECH = [
  "小红书",
  "得物",
  "知乎",
  "汽车之家",
  "爱奇艺",
  "携程",
  "去哪儿",
  "贝壳",
  "自如",
  "搜狐",
  "新浪",
  "微博",
  "b站",
  "哔哩哔哩",
  "喜马拉雅",
  "阅文",
  "快看漫画",
  "脉脉",
  "理想汽车",
  "蔚来",
  "小鹏",
];

export const SEED_STAR_STARTUP = [
  "智谱",
  "智谱华章",
  "月之暗面",
  "kimi",
  "阶跃星辰",
  "minimax",
  "百川智能",
  "零一万物",
  "生数科技",
  "面壁智能",
  "深度求索",
  "deepseek",
  "循环智能",
  "澜舟科技",
  "衔远科技",
  "爱诗科技",
  "生数",
];

export function classifyCompanyTier(job) {
  const company = job.company || {};
  const name = (company.name || "").trim().toLowerCase();
  const scale = (company.size || "").trim();
  const stage = (company.financing_stage || "").trim();
  const industry = (company.industry || "").trim();
  const title = (job.title || "").trim();
  const maxAnnual = job.salary?.annual_cash_max_cny || 0;
  const minAnnual = job.salary?.annual_cash_min_cny || 0;

  // 1. Check known seeds
  for (const big of SEED_BIG_TECH) {
    if (name.includes(big.toLowerCase())) {
      return {
        tier: "big_tech",
        tier_label: "大厂",
        is_reputable: true,
        matched_by: `seed_big_tech:${big}`,
        confidence: "high",
      };
    }
  }

  for (const startup of SEED_STAR_STARTUP) {
    if (name.includes(startup.toLowerCase())) {
      return {
        tier: "star_startup",
        tier_label: "知名AI创企",
        is_reputable: true,
        matched_by: `seed_star_startup:${startup}`,
        confidence: "high",
      };
    }
  }

  for (const mid of SEED_MID_TECH) {
    if (name.includes(mid.toLowerCase())) {
      return {
        tier: "mid_tech",
        tier_label: "中厂",
        is_reputable: true,
        matched_by: `seed_mid_tech:${mid}`,
        confidence: "high",
      };
    }
  }

  // 2. Objective dynamic rules
  // Rule A: Big Tech by scale and listing
  if (/10000人以上/.test(scale) && (/已上市/.test(stage) || /不需要融资/.test(stage))) {
    return {
      tier: "big_tech",
      tier_label: "大厂",
      is_reputable: true,
      matched_by: "scale_10000_plus_listed",
      confidence: "high",
    };
  }

  // Rule B: Mid Tech by scale and round
  if ((/1000-9999人/.test(scale) || /500-999人/.test(scale)) && (/已上市/.test(stage) || /[bcd]轮/i.test(stage) || /战略融资/.test(stage))) {
    return {
      tier: "mid_tech",
      tier_label: "中厂",
      is_reputable: true,
      matched_by: "scale_1000_plus_funded",
      confidence: "medium_high",
    };
  }

  // Rule C: Star Startup (scale <= 500, verified venture round, competitive salary or explicit AI focus)
  const isVentureFunded = /天使轮|[abc]轮|战略投资|战略融资/.test(stage);
  const isAiContext = /大模型|agent|智能体|人工智能|ai|算法/.test(`${industry} ${title}`);
  const hasCompetitiveSalary = maxAnnual >= 400000 || minAnnual >= 250000;

  if (isVentureFunded && (isAiContext || hasCompetitiveSalary)) {
    return {
      tier: "star_startup",
      tier_label: "知名AI创企",
      is_reputable: true,
      matched_by: "venture_backed_ai_or_high_salary",
      confidence: "medium",
    };
  }

  // Rule D: Unbacked micro workshop without external funding & low salary -> not reputable
  const isMicroScale = /0-20人|20人以下/.test(scale);
  const isUnfunded = /未融资|不需要融资/.test(stage) || !stage;
  if (isMicroScale && isUnfunded && maxAnnual < 350000) {
    return {
      tier: "other",
      tier_label: "普通自研/微型",
      is_reputable: false,
      matched_by: "unbacked_micro_workshop",
      confidence: "high",
    };
  }

  return {
    tier: "other",
    tier_label: "其他自研企业",
    is_reputable: maxAnnual >= 300000 || stage !== "未融资",
    matched_by: "fallback_general",
    confidence: "medium",
  };
}
