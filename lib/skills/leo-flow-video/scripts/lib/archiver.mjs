import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";

export function sanitizeTitle(prompt = "video") {
  return prompt
    .trim()
    .replace(/[^\w\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30) || "video";
}

export function formatDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    timestamp: `${yyyy}${mm}${dd}_${hh}${min}${ss}`,
    timeStr: `${hh}${min}${ss}`
  };
}

export async function archiveVideoAsset({
  videoBuffer,
  prompt,
  ratio = "16:9",
  resolution = "720p",
  count = 1,
  pointsCost = 60,
  projectUrl = "https://flow.google.com/",
  baseOutputDir
}) {
  const { dateStr, timeStr } = formatDateTime();
  const safeTitle = sanitizeTitle(prompt);
  const ratioSlug = (ratio || "16:9").replace(":", "x");

  // 1. 工程目录命名 (参考 douyin 规范: YYYY-MM-DD-flow_<安全标题>)
  let targetDirName = `${dateStr}-flow_${safeTitle}`;
  let saveDir = path.join(baseOutputDir, targetDirName);
  if (syncFs.existsSync(saveDir)) {
    targetDirName = `${dateStr}-${timeStr}-flow_${safeTitle}`;
    saveDir = path.join(baseOutputDir, targetDirName);
  }

  // 2. 内部中文子目录结构 (参考 douyin: 成片、素材、音频、字幕)
  const finalDir = path.join(saveDir, "成片");
  const rawVideoDir = path.join(finalDir, "原始版");
  const publishVideoDir = path.join(finalDir, "发布版");
  const coverDir = path.join(finalDir, "封面");
  const materialDir = path.join(saveDir, "素材");
  const shotDir = path.join(materialDir, "视频分镜");
  const audioDir = path.join(saveDir, "音频");
  const subtitleDir = path.join(saveDir, "字幕");

  await Promise.all([
    fs.mkdir(rawVideoDir, { recursive: true }),
    fs.mkdir(publishVideoDir, { recursive: true }),
    fs.mkdir(coverDir, { recursive: true }),
    fs.mkdir(shotDir, { recursive: true }),
    fs.mkdir(audioDir, { recursive: true }),
    fs.mkdir(subtitleDir, { recursive: true })
  ]);

  // 3. 落盘原画视频至 成片/原始版/
  const videoFileName = `${safeTitle}_${ratioSlug}_${resolution}.mp4`;
  const targetVideoPath = path.join(rawVideoDir, videoFileName);
  await fs.writeFile(targetVideoPath, videoBuffer);

  const stat = syncFs.statSync(targetVideoPath);
  const fileSizeMB = (stat.size / 1024 / 1024).toFixed(2);
  const relativeVideoPath = path.relative(saveDir, targetVideoPath).replace(/\\/g, "/");

  // 4. 脚本.md (参考 douyin 脚本分镜规范)
  const scriptPath = path.join(saveDir, "脚本.md");
  const scriptContent = `# 《${safeTitle}》· 视频脚本与分镜规格

> **项目主题**：${safeTitle}  
> **归档工程**：\`${targetDirName}\`  
> **生成引擎**：Google Flow (flow.google.com / Veo 视频工作台)  
> **画幅规格**：🏷️ ${ratio} (${ratioSlug})  
> **输出分辨率**：📺 ${resolution}  
> **单镜时长**：⏱️ 15 秒  
> **能耗控制**：🪙 单次生成 1 批次（消耗 60 点，已自动优化省点）  

---

## 一、 提示词 (Prompt)

\`\`\`text
${prompt}
\`\`\`

---

## 二、 镜头视听设想

- **运镜机位**：由 Google Veo 模型解析最佳动态镜头语言
- **画面构图**：${ratio === "9:16" ? "9:16 竖屏聚焦（适合抖音 / 小红书 / 视频号）" : "16:9 横屏宽银幕电影感（适合 B站 / YouTube / 电脑端）"}
- **调色质感**：自然光影漫反射、环境微动、材质物理动态高保真呈现
`;
  await fs.writeFile(scriptPath, scriptContent, "utf8");

  // 5. 交付记录.md (参考 douyin 交付记录与平台分发建议规范)
  const deliveryPath = path.join(saveDir, "交付记录.md");
  const deliveryContent = `# 《${safeTitle}》Google Flow 视频交付记录

- **创建时间**：${new Date().toLocaleString()}
- **归档路径**：\`${saveDir}\`
- **生成平台**：Google Flow (flow.google.com)
- **选用模型**：Google Veo 视频模型
- **画面比例**：🏷️ \`${ratio}\`
- **清晰度**：📺 \`${resolution}\`
- **视频时长**：⏱️ 15 秒
- **单次消耗点数**：🪙 ${pointsCost} 点 (已自动纠偏省点)
- **项目直达地址**：[查看 Flow 项目](${projectUrl})

---

## 平台分发建议与即用型标题矩阵 (3-Pick 战术矩阵)

### 1. 哔哩哔哩 (Bilibili · 首选平台)
- **【战术A · 认知颠覆】**：《${safeTitle}》实测：耗时X天我们推翻了一个行业常识
- **【战术B · 痛点避雷】**：为什么我不建议你盲目跟风《${safeTitle}》？
- **【战术C · 硬核验证】**：自制《${safeTitle}》全记录：结果超出所有人预期
- **建议发布排期**：次日 16:30（黄金高峰时段）
- **平台合规标签**：声明为自制，规范勾选「含AI生成内容」

### 2. 抖音 (Douyin · 单列前3秒留存)
- **【战术A · 矛盾站队】**：如果你也想做《${safeTitle}》，看完这条再决定！#${safeTitle} #AI视频
- **【战术B · 结果前置】**：别眨眼！这就是《${safeTitle}》的真实视觉冲击…
- **【战术C · 痛点共情】**：看完《${safeTitle}》，瞬间被治愈了

### 3. 小红书视频 (RedNote · 双列搜索卡位)
- **【战术A · 避雷劝退】**：关于《${safeTitle}》千万别踩这3个坑😭
- **【战术B · 痛点干货】**：新手必看｜手把手教你搞懂《${safeTitle}》视觉生成📌
- **【战术C · 神仙平替】**：用 Google Flow 高画质搞定《${safeTitle}》｜建议码住✨

---

## 交付文件清单
- [x] 成片/原始版/${videoFileName} (${fileSizeMB} MB)
- [ ] 成片/发布版/（待压制字幕或后期合成）
- [ ] 成片/封面/（待提取关键帧封面）
- [x] 脚本.md
- [x] 交付记录.md
- [x] 生成事实.json

---

## 完整提示词 (Prompt)

\`\`\`text
${prompt}
\`\`\`
`;
  await fs.writeFile(deliveryPath, deliveryContent, "utf8");

  // 6. 生成事实.json (机器可读的结构化事实元数据)
  const jsonPath = path.join(saveDir, "生成事实.json");
  const metadata = {
    platform: "Google Flow",
    prompt,
    ratio,
    resolution,
    count,
    videoDurationSec: 15,
    pointsCost,
    createdAt: new Date().toISOString(),
    projectUrl,
    localMedia: {
      video: relativeVideoPath,
      fileSizeBytes: stat.size,
      fileSizeMB
    },
    directoryStructure: {
      rawVideoDir: "成片/原始版",
      publishVideoDir: "成片/发布版",
      coverDir: "成片/封面",
      materialDir: "素材/视频分镜",
      audioDir: "音频",
      subtitleDir: "字幕"
    }
  };
  await fs.writeFile(jsonPath, JSON.stringify(metadata, null, 2), "utf8");

  return {
    saveDir,
    finalDir,
    rawVideoDir,
    videoPath: targetVideoPath,
    jsonPath,
    mdPath: deliveryPath,
    scriptPath,
    fileSizeMB,
    metadata
  };
}
