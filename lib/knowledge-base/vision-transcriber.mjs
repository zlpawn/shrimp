import fs from "node:fs";
import path from "node:path";

/**
 * Detect image MIME type from file extension.
 */
export function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

/**
 * Convert local image file to base64 data URL.
 */
export function imageToDataUrl(filePath) {
  const buffer = fs.readFileSync(filePath);
  const mimeType = getMimeType(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Standard system prompt for Multimodal Vision transcription.
 */
export const VISION_SYSTEM_PROMPT = `你是一个顶级技术架构、工程图表与多模态视觉知识深度解读专家。
你的任务是将传入的原始图片（技术架构图、业务流程图、时序图、数据表格、实物照片、会议白板或风景人文照片）精准转译为全平台高兼容性的结构化 Markdown 与 Mermaid 代码，供工程知识库长期沉淀与语义检索。

【输出规范】：
1. **类型自适应识别**：
   - 若为架构/流程/时序图表：重点输出高保真 Mermaid 代码块与系统级业务逻辑解读；
   - 若为数据表格/对比图：还原为标准 Markdown 表格与数据指标洞察；
   - 若为实物照片/会议现场/白板拍照/风景照片：深入分析主体特征、提取图内全部 OCR 文字并归纳核心事实要点。

2. **Mermaid 全平台（Typora / VS Code / Obsidian / GitHub）100% 语法通用规范**：
   - 流程图类型统一使用 \`flowchart TD\` 或 \`flowchart LR\`；
   - **节点文本必须严格使用英文字双引号包裹**，例如：\`Node_A["客户端 (Web/iOS/Android)"] --> Node_B["API 网关"]\`，严禁节点文字中出现裸括号、斜杠或特殊符号导致解析报错！
   - 节点 ID 必须使用纯英文字母、数字或下划线（如 \`Client_1\`, \`Gateway_API\`），严禁使用中文作为节点 ID；
   - 连线与拓扑关系必须与原图严格一致，严禁凭空捏造未出现的节点。

3. **数据表格还原**：
   - 遵循 GitHub Flavored Markdown (GFM) 标准，包含完整的表头与分隔线（|---|---|）。

4. **实体与业务逻辑文字解读**：
   - 条理分明地列出各组件/实体的职责、数据流转路线或场景核心事实；
   - 提取图表传达的核心技术决策或关键业务逻辑。

5. **拒绝幻觉**：
   - 对图中模糊不清或无法确定的部分，明确标注「[?] 局部模糊无法辨识」，严禁脑补。`;

/**
 * Build a complete, cohesive Markdown document combining Mermaid, tables, and narrative explanation.
 */
export function buildCompleteMarkdownDocument({
  title = "图像与视觉解析",
  assetUrl = "",
  filename = "image.png",
  mermaidCode = "",
  tableMarkdown = "",
  rawContent = "",
  bulletPoints = [],
  model = "Vision LLM",
} = {}) {
  const lines = [];
  lines.push(`# ${title}\n`);
  if (assetUrl || filename) {
    lines.push(`> 📸 原始凭证: [${filename}](${assetUrl}) | 识别模型: ${model}\n`);
  }

  if (mermaidCode) {
    lines.push("## 结构化架构与流转图 (Mermaid)\n");
    lines.push("```mermaid");
    lines.push(mermaidCode);
    lines.push("```\n");
  }

  if (tableMarkdown) {
    lines.push("## 结构化数据表格\n");
    lines.push(tableMarkdown);
    lines.push("");
  }

  if (rawContent) {
    // Strip redundant mermaid fences from explanation body to keep clean
    const cleanExplanation = rawContent
      .replace(/```mermaid[\s\S]*?```/gi, "")
      .replace(/^#+\s.*$/gm, "")
      .trim();
    if (cleanExplanation) {
      lines.push("## 核心内容与业务逻辑解读\n");
      lines.push(cleanExplanation);
      lines.push("");
    }
  } else if (bulletPoints && bulletPoints.length > 0) {
    lines.push("## 核心信息提炼\n");
    bulletPoints.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build user prompt for image transcription.
 */
export function buildVisionPrompt({ title = "", sourceType = "doc", timestampOrPage = "" } = {}) {
  let prompt = "请对这张图片进行深度技术转译。";
  if (sourceType === "video" && timestampOrPage) {
    prompt += ` 此图为视频在时间戳 [${timestampOrPage}] 处的关键画面。`;
  } else if (sourceType === "doc" && timestampOrPage) {
    prompt += ` 此图为技术文档 [${timestampOrPage}] 处的原始插图。`;
  }
  if (title) {
    prompt += ` 标题/上下文：${title}。`;
  }
  prompt += "\n若为拓扑/架构/流程图，请输出完整合规的 Mermaid 代码块，并提炼 2~3 点核心设计要点。";
  return prompt;
}

/**
 * Parse LLM vision output to extract Mermaid code, tables, and structured summaries.
 */
export function parseVisionResponse(rawText = "") {
  const text = String(rawText || "").trim();

  // Extract Mermaid block
  let mermaidCode = "";
  const mermaidMatch = text.match(/```mermaid\s*([\s\S]*?)```/i);
  if (mermaidMatch) {
    mermaidCode = mermaidMatch[1].trim();
  }

  // Extract Markdown table
  const lines = text.split(/\r?\n/);
  const tableLines = [];
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      inTable = true;
      tableLines.push(trimmed);
    } else if (inTable) {
      break;
    }
  }
  const tableMarkdown = tableLines.length >= 2 ? tableLines.join("\n") : "";

  // Extract bullet points
  const bulletPoints = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      bulletPoints.push(trimmed.replace(/^[-*•\d.]+\s*/, ""));
    }
  }

  return {
    rawContent: text,
    mermaidCode,
    tableMarkdown,
    bulletPoints,
    hasMermaid: Boolean(mermaidCode),
    hasTable: Boolean(tableMarkdown),
  };
}

/**
 * Format timestamp (seconds to MM:SS or HH:MM:SS).
 */
export function formatTimestamp(seconds) {
  if (seconds == null || isNaN(seconds)) return "";
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Generate standard HTML/Markdown Traceable Evidence Card.
 */
export function buildEvidenceCardHtml({
  assetUrl,
  filename = "image.png",
  title = "原始图表",
  sourceType = "doc",
  timestampOrPage = "",
  interpretation = "",
  mermaidCode = "",
  bulletPoints = [],
} = {}) {
  const anchorLabel = timestampOrPage
    ? (sourceType === "video" ? `⏱️ 关键帧 [${timestampOrPage}]` : `📄 文档位置 [${timestampOrPage}]`)
    : filename;

  let bodyContent = "";

  if (mermaidCode) {
    bodyContent += `\n\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n`;
  }

  if (interpretation) {
    bodyContent += `\n${interpretation.trim()}\n`;
  } else if (bulletPoints.length > 0) {
    bodyContent += `\n> 💡 **核心信息提炼**：\n${bulletPoints.map((b, i) => `> ${i + 1}. ${b}`).join("\n")}\n`;
  }

  return `<div class="kb-evidence-card" data-asset="${escapeAttr(filename)}" data-source-type="${escapeAttr(sourceType)}" data-anchor="${escapeAttr(timestampOrPage)}">
  <div class="kb-evidence-header">
    <div class="kb-evidence-title">
      <span class="kb-evidence-badge">📸 原始物理凭证</span>
      <span class="kb-evidence-anchor">${escapeHtml(anchorLabel)}</span>
    </div>
    <a href="${escapeAttr(assetUrl)}" target="_blank" rel="noopener" class="kb-evidence-zoom-link" title="点击查看高分辨率原图">🔍 查看原图</a>
  </div>
  <div class="kb-evidence-preview">
    <img src="${escapeAttr(assetUrl)}" alt="${escapeAttr(title || filename)}" loading="lazy" class="kb-evidence-img" />
  </div>
  <details open class="kb-evidence-details">
    <summary class="kb-evidence-summary">🤖 视觉大模型深度转译 (Mermaid 拓扑 & 语义解析)</summary>
    <div class="kb-evidence-body">
${bodyContent}
    </div>
  </details>
</div>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Call Gateway OpenAI-compatible Chat Completions with Vision payload.
 */
export async function callGatewayVisionLLM({
  client = "code",
  endpointId = "",
  model = "qwen-vl-max",
  dataUrl = "",
  imagePath = "",
  prompt = "",
  listenPort = 8788,
  timeoutMs = 60000,
  signal = null,
} = {}) {
  let resolvedDataUrl = dataUrl;
  if (!resolvedDataUrl && imagePath && fs.existsSync(imagePath)) {
    resolvedDataUrl = imageToDataUrl(imagePath);
  }
  if (!resolvedDataUrl) {
    throw new Error("Missing image: neither valid dataUrl nor imagePath provided");
  }

  const endpointQuery = endpointId ? `?endpoint_id=${encodeURIComponent(endpointId)}` : "";
  const url = `http://127.0.0.1:${listenPort}/${encodeURIComponent(client)}/v1/chat/completions${endpointQuery}`;

  const userText = prompt || "请深度转译此图，若为流程或架构图请输出标准 Mermaid 代码，并提炼核心要点。";

  const messages = [
    {
      role: "system",
      content: VISION_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        { type: "text", text: userText },
        {
          type: "image_url",
          image_url: {
            url: resolvedDataUrl,
          },
        },
      ],
    },
  ];

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gateway-client": client,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 3000,
        ...(endpointId ? { endpoint_id: endpointId } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Vision LLM request failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    return {
      content,
      usage: data.usage || null,
      model: data.model || model,
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Transcribe an image using Vision LLM and build an Evidence Card.
 */
export async function transcribeImageWithVisionLLM({
  imagePath,
  dataUrl,
  assetUrl,
  filename,
  title,
  sourceType = "doc",
  timestampOrPage = "",
  client = "code",
  endpointId = "",
  model = "qwen-vl-max",
  listenPort = 8788,
  signal = null,
} = {}) {
  const prompt = buildVisionPrompt({ title, sourceType, timestampOrPage });
  const llmRes = await callGatewayVisionLLM({
    client,
    endpointId,
    model,
    dataUrl,
    imagePath,
    prompt,
    listenPort,
    signal,
  });

  const parsed = parseVisionResponse(llmRes.content);
  const cardHtml = buildEvidenceCardHtml({
    assetUrl: assetUrl || (imagePath ? `assets/${path.basename(imagePath)}` : filename),
    filename: filename || (imagePath ? path.basename(imagePath) : "image.png"),
    title: title || filename,
    sourceType,
    timestampOrPage,
    interpretation: parsed.rawContent,
    mermaidCode: parsed.mermaidCode,
    bulletPoints: parsed.bulletPoints,
  });

  return {
    ok: true,
    cardHtml,
    rawContent: parsed.rawContent,
    mermaidCode: parsed.mermaidCode,
    bulletPoints: parsed.bulletPoints,
    tableMarkdown: parsed.tableMarkdown,
    model: llmRes.model,
  };
}
