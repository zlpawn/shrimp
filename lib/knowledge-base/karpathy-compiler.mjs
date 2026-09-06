/**
 * Karpathy LLM Wiki Compiler Service
 *
 * Implements Andrej Karpathy's "Stop retrieving. Start compiling." paradigm:
 * 1. Discovers configured gateway chat models.
 * 2. Compiles raw multi-source documents into atomic concept cards with [[wikilinks]].
 * 3. Supports stateless incremental refinement ("第一次输出不满意可以增量修改").
 * 4. Applies approved drafts into an offline, self-contained Obsidian Vault (raw/, wiki/, 00-Meta/).
 */

import fs from "node:fs";
import path from "node:path";

export function stripCodeFence(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("```")) return raw;
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractJsonObject(text) {
  const raw = stripCodeFence(text);
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function sanitizeFileName(name) {
  return String(name || "untitled")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim()
    .slice(0, 100) || "untitled";
}

export function getAvailableChatModels(config = {}) {
  const models = [];
  const clients = config.clients || {};

  for (const [clientKey, clientConfig] of Object.entries(clients)) {
    const endpoints = Array.isArray(clientConfig?.endpoints) ? clientConfig.endpoints : [];
    for (const ep of endpoints) {
      if (ep && ep.enabled !== false && (!ep.purpose || ep.purpose === "chat")) {
        const epModels = Array.isArray(ep.models) ? ep.models : [];
        for (const m of epModels) {
          const modelId = String(m || "").trim();
          if (!modelId) continue;
          models.push({
            client: clientKey,
            endpointId: ep.id,
            endpointName: ep.name || ep.id,
            model: modelId,
            displayName: `${ep.name || ep.id} (${modelId})`,
            isDefault: Boolean(ep.is_default),
          });
        }
      }
    }
  }

  // Fallback defaults if no endpoint models found
  if (models.length === 0) {
    models.push({
      client: "code",
      endpointId: "default",
      endpointName: "Default Gateway Endpoint",
      model: "glm-5.2",
      displayName: "Default (glm-5.2)",
      isDefault: true,
    });
  }

  return models;
}

export function readExistingVaultConcepts(vaultRoot) {
  if (!vaultRoot || !fs.existsSync(vaultRoot)) return [];
  const wikiDir = path.join(vaultRoot, "wiki");
  if (!fs.existsSync(wikiDir)) return [];
  try {
    const files = fs.readdirSync(wikiDir);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function callChatCompletions({
  messages,
  client = "code",
  model = "glm-5.2",
  endpointId = "",
  listenPort = 8787,
  timeoutMs = 90000,
  signal = null,
} = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpointQuery = endpointId ? `?endpoint_id=${encodeURIComponent(endpointId)}` : "";
    const url = `http://127.0.0.1:${listenPort}/${encodeURIComponent(client)}/v1/chat/completions${endpointQuery}`;

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
        max_tokens: 3500,
        ...(endpointId ? { endpoint_id: endpointId } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gateway LLM request failed (${res.status}): ${errText.slice(0, 300)}`);
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

export function buildCompilerPrompt(existingConcepts = []) {
  const conceptsHint = existingConcepts.length > 0
    ? `现存 Obsidian Vault 已有核心概念（请优先识别联系并用 [[概念名]] 双向链接引用）：\n${existingConcepts.slice(0, 50).map((c) => `- [[${c}]]`).join("\n")}`
    : `当前 Obsidian Vault 暂无历史概念，这是首批创建的知识卡片。`;

  return [
    `你是一位遵循 Andrej Karpathy "Stop retrieving. Start compiling."（不要反复检索，而要持续编译）理念的顶级知识架构师。`,
    `你的任务是将用户提供的原始材料深度重构并编译为高密度、概念解耦、网状互联的 Obsidian 原子卡片知识库。`,
    ``,
    `【编译核心原则】：`,
    `1. 一概念一卡片（Atomic Concept）：严禁将全文整篇原样输出！必须提炼出 2~4 个承重级核心原子概念（核心原理、决策模型、算法机制等）。`,
    `2. 密集双向链接：正文中必须广泛使用 Obsidian 标准双向链接 [[概念名称]]。当概念间存在推导、对比或依赖时，务必互相打通链接。`,
    `3. 第一性原理与三层结构：卡片正文包含核心本质推导、运行机理拓扑、权衡与边界、以及交叉关联概念。`,
    `4. 离线友好与自包含：生成标准的 Markdown 正文，支持 Obsidian 渲染。`,
    ``,
    `【知识库上下文】：`,
    conceptsHint,
    ``,
    `【输出格式规范】：`,
    `必须且仅输出一个合法的 JSON 对象，格式如下：`,
    `{`,
    `  "summary": "简短概述（80字以内，说明提炼了哪些关键概念）",`,
    `  "index_category": "推荐在 00-Meta/index.md 归属的分类（如：认知与逻辑 / 系统架构 / 机器学习 等）",`,
    `  "log_entry": "一句话编译日志（例如：编译《谬误分析》 -> 生成 [[滑坡谬误]]、[[归纳偏差]]）",`,
    `  "concepts": [`,
    `    {`,
    `      "title": "原子概念名称（例如：滑坡谬误）",`,
    `      "aliases": ["别名1", "English Name"],`,
    `      "category": "所属细分领域",`,
    `      "tags": ["标签1", "标签2"],`,
    `      "summary": "一句话本质定义",`,
    `      "content_markdown": "## 核心定义与第一性原理\\n...\\n\\n## 运行机理与推导链路\\n...\\n\\n## 权衡、边界与失效模式\\n...\\n\\n## 关联概念\\n- [[关联概念A]]\\n- [[关联概念B]]"`,
    `    }`,
    `  ]`,
    `}`,
    `注意：JSON 中的 content_markdown 必须是纯正文内容（不要包含最外层的 frontmatter，系统落盘时会自动注入标准元数据）。只输出合法 JSON，禁止输出 markdown 代码围栏外的任何闲聊。`,
  ].join("\n");
}

export function buildRefinePrompt() {
  return [
    `你是一位遵循 Andrej Karpathy LLM Wiki 范式的知识精炼专家。`,
    `用户对上一轮编译生成的知识库草稿提出了具体的【增量修改与调整意见】。`,
    `你的任务是：根据用户的修改意见，在保留上一轮优质提炼的基础上，对草稿进行增量修改、概念合并/拆分、内容重写或视角调整。`,
    ``,
    `【输出格式规范】：`,
    `必须且仅输出与初次编译相同 schema 的合法 JSON 对象（包含 summary, index_category, log_entry, concepts 数组）。`,
    `只输出合法 JSON，禁止输出额外解释。`,
  ].join("\n");
}

export function createKarpathyCompiler({ config = {}, dataDir = "", listenPort = 8787 } = {}) {
  return {
    getModels() {
      return getAvailableChatModels(config);
    },

    async compileDraft({
      documents = [],
      vaultRoot = "",
      client = "code",
      model = "",
      endpointId = "",
      customInstruction = "",
      engine = "markitdown",
      signal = null,
    } = {}) {
      if (!documents || documents.length === 0) {
        throw new Error("没有提供待编译的文档材料");
      }

      // Read existing concepts in vault to weave links
      const existingConcepts = readExistingVaultConcepts(vaultRoot);

      // Concatenate documents text
      const rawText = documents
        .map((doc, idx) => {
          const title = doc.title || `材料 ${idx + 1}`;
          const content = engine === "docling"
            ? String(doc.docling_md || doc.markitdown_md || doc.markdown || doc.text || doc.content || "").slice(0, 15000)
            : String(doc.markitdown_md || doc.docling_md || doc.markdown || doc.text || doc.content || "").slice(0, 15000);
          return `# 材料 ${idx + 1}: ${title}\n\n${content}`;
        })
        .join("\n\n---\n\n");

      const systemPrompt = buildCompilerPrompt(existingConcepts);
      const userContent = [
        customInstruction ? `【用户自定义要求】：${customInstruction}\n` : "",
        `【原始输入材料全文】：\n${rawText}`,
      ].filter(Boolean).join("\n");

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];

      const llmRes = await callChatCompletions({
        messages,
        client,
        model,
        endpointId,
        listenPort,
        signal,
      });

      const parsed = extractJsonObject(llmRes.content);
      if (!parsed || !Array.isArray(parsed.concepts) || parsed.concepts.length === 0) {
        throw new Error(`模型未返回符合规范的原子概念 JSON 草稿。原始返回摘要：${llmRes.content.slice(0, 200)}`);
      }

      return {
        draft: {
          summary: parsed.summary || "已编译为原子知识卡片",
          index_category: parsed.index_category || "通用主题",
          log_entry: parsed.log_entry || `编译 ${documents.length} 份材料`,
          concepts: parsed.concepts.map((c) => ({
            title: sanitizeFileName(c.title || "未命名概念"),
            aliases: Array.isArray(c.aliases) ? c.aliases : [],
            category: c.category || parsed.index_category || "通用主题",
            tags: Array.isArray(c.tags) ? c.tags : [],
            summary: c.summary || "",
            content_markdown: String(c.content_markdown || c.markdown || "").trim(),
          })),
        },
        model: llmRes.model,
        usage: llmRes.usage,
      };
    },

    async refineDraft({
      draft,
      feedback = "",
      documents = [],
      vaultRoot = "",
      client = "code",
      model = "",
      endpointId = "",
      signal = null,
    } = {}) {
      if (!draft || !Array.isArray(draft.concepts)) {
        throw new Error("缺少待修正的原始编译草稿");
      }
      if (!feedback.trim()) {
        throw new Error("请输入具体的增量修改建议");
      }

      const existingConcepts = readExistingVaultConcepts(vaultRoot);
      const systemPrompt = buildRefinePrompt();

      const rawSnippet = documents
        .map((d) => `标题: ${d.title}\n${String(d.markdown || d.text || "").slice(0, 4000)}`)
        .join("\n\n");

      const userContent = [
        `【知识库现存概念】：${existingConcepts.slice(0, 30).join(", ") || "无"}`,
        ``,
        `【原始材料摘要】：\n${rawSnippet}`,
        ``,
        `【上一轮生成的草稿】：\n${JSON.stringify(draft, null, 2)}`,
        ``,
        `【用户本次增量修改意见】：\n${feedback}`,
        ``,
        `请严格针对用户的修改意见，输出修正后的完整 JSON 草稿。`,
      ].join("\n");

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];

      const llmRes = await callChatCompletions({
        messages,
        client,
        model,
        endpointId,
        listenPort,
        signal,
      });

      const parsed = extractJsonObject(llmRes.content);
      if (!parsed || !Array.isArray(parsed.concepts) || parsed.concepts.length === 0) {
        throw new Error(`模型返回的修正草稿未能解析为有效 JSON。原始返回：${llmRes.content.slice(0, 200)}`);
      }

      return {
        draft: {
          summary: parsed.summary || draft.summary,
          index_category: parsed.index_category || draft.index_category,
          log_entry: parsed.log_entry || `增量修正: ${feedback.slice(0, 30)}`,
          concepts: parsed.concepts.map((c) => ({
            title: sanitizeFileName(c.title || "未命名概念"),
            aliases: Array.isArray(c.aliases) ? c.aliases : [],
            category: c.category || parsed.index_category || draft.index_category,
            tags: Array.isArray(c.tags) ? c.tags : [],
            summary: c.summary || "",
            content_markdown: String(c.content_markdown || c.markdown || "").trim(),
          })),
        },
        model: llmRes.model,
        usage: llmRes.usage,
      };
    },

    applyDraftToVault({ draft, documents = [], vaultRoot = "", kbDataDir = "", engine = "markitdown" } = {}) {
      if (!vaultRoot || typeof vaultRoot !== "string") {
        throw new Error("必须提供有效的 Obsidian Vault 根目录绝对路径");
      }
      if (!draft || !Array.isArray(draft.concepts) || draft.concepts.length === 0) {
        throw new Error("草稿中没有可落盘的概念卡片");
      }

      const resolvedRoot = path.resolve(vaultRoot);
      const rawDir = path.join(resolvedRoot, "raw");
      const rawAssetsDir = path.join(rawDir, "assets");
      const wikiDir = path.join(resolvedRoot, "wiki");
      const metaDir = path.join(resolvedRoot, "00-Meta");

      fs.mkdirSync(rawDir, { recursive: true });
      fs.mkdirSync(rawAssetsDir, { recursive: true });
      fs.mkdirSync(wikiDir, { recursive: true });
      fs.mkdirSync(metaDir, { recursive: true });

      const today = new Date().toISOString().slice(0, 10);
      const writtenFiles = [];
      const primaryDocTitle = documents[0]?.title || "知识沉淀";

      // 1. Write raw materials with localized assets
      const rawFileNames = [];
      for (const doc of documents) {
        const rawFileName = `${today}-${sanitizeFileName(doc.title || "材料")}.md`;
        const rawFilePath = path.join(rawDir, rawFileName);
        rawFileNames.push(rawFileName);

        // Copy assets from kbDataDir/files/<doc.id>/assets to raw/assets
        if (doc.id && kbDataDir) {
          const srcAssetsDir = path.join(kbDataDir, "files", doc.id, "assets");
          if (fs.existsSync(srcAssetsDir)) {
            try {
              const assetEntries = fs.readdirSync(srcAssetsDir);
              for (const assetName of assetEntries) {
                const srcPath = path.join(srcAssetsDir, assetName);
                const destPath = path.join(rawAssetsDir, assetName);
                if (fs.statSync(srcPath).isFile()) {
                  fs.copyFileSync(srcPath, destPath);
                }
              }
            } catch (err) {
              console.warn(`[karpathy-compiler] asset copy error: ${err.message}`);
            }
          }
        }

        // Rewrite asset paths to relative "assets/..."
        let cleanMarkdown = engine === "docling"
          ? String(doc.docling_md || doc.markitdown_md || doc.markdown || doc.text || doc.content || "")
          : String(doc.markitdown_md || doc.docling_md || doc.markdown || doc.text || doc.content || "");
        cleanMarkdown = cleanMarkdown.replace(
          /(?:\/v1\/kb\/files\/[^/]+\/assets\/|assets\/)([^")\s]+)/g,
          "assets/$1"
        );

        const rawContent = [
          `---`,
          `title: "${doc.title || "原始文档"}"`,
          `source_type: "${doc.source_type || "document"}"`,
          `source_url: "${doc.source_url || ""}"`,
          `archived_at: "${today}"`,
          `status: "immutable_raw"`,
          `---`,
          ``,
          `# ${doc.title || "原始文档"}`,
          ``,
          cleanMarkdown,
        ].join("\n");

        fs.writeFileSync(rawFilePath, rawContent, "utf8");
        writtenFiles.push(`raw/${rawFileName}`);
      }

      // 2. Write concept cards to wiki/
      const conceptTitles = [];
      for (const concept of draft.concepts) {
        const cleanTitle = sanitizeFileName(concept.title);
        conceptTitles.push(cleanTitle);
        const cardFileName = `${cleanTitle}.md`;
        const cardFilePath = path.join(wikiDir, cardFileName);

        const cardContent = [
          `---`,
          `title: "${cleanTitle}"`,
          `aliases: ${JSON.stringify(concept.aliases || [])}`,
          `category: "${concept.category || draft.index_category || "知识沉淀"}"`,
          `tags: ${JSON.stringify(concept.tags || [])}`,
          `source: "raw/${rawFileNames[0] || "source.md"}"`,
          `compiled_by: "gateway-karpathy-compiler"`,
          `compiled_at: "${today}"`,
          `status: "compiled"`,
          `---`,
          ``,
          `# ${cleanTitle}`,
          ``,
          concept.content_markdown || "",
        ].join("\n");

        fs.writeFileSync(cardFilePath, cardContent, "utf8");
        writtenFiles.push(`wiki/${cardFileName}`);
      }

      // 3. Update 00-Meta/index.md (Map of Content)
      const indexFilePath = path.join(metaDir, "index.md");
      let indexContent = "";
      if (fs.existsSync(indexFilePath)) {
        indexContent = fs.readFileSync(indexFilePath, "utf8");
      } else {
        indexContent = [
          `# 知识大纲与主题地图 (MOC - Map of Content)`,
          ``,
          `> 本索引由 Karpathy LLM Wiki 编译器自动聚合维护，按主题聚合所有原子概念卡片。`,
          ``,
        ].join("\n");
      }

      const targetCategory = draft.index_category || "通用概念";
      const categoryHeader = `## ${targetCategory}`;
      const newLinks = conceptTitles.map((t) => `- [[${t}]]`).join("\n");

      if (indexContent.includes(categoryHeader)) {
        // Append under existing category header
        indexContent = indexContent.replace(
          new RegExp(`(${categoryHeader}[^\\n]*\\n)`),
          `$1${newLinks}\n`
        );
      } else {
        indexContent += `\n\n${categoryHeader}\n${newLinks}\n`;
      }
      fs.writeFileSync(indexFilePath, indexContent, "utf8");
      writtenFiles.push("00-Meta/index.md");

      // 4. Append to 00-Meta/log.md (Audit log)
      const logFilePath = path.join(metaDir, "log.md");
      let logContent = "";
      if (fs.existsSync(logFilePath)) {
        logContent = fs.readFileSync(logFilePath, "utf8");
      } else {
        logContent = `# 知识库编译与演进日志 (Evolution Log)\n\n`;
      }

      const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
      const logLine = `- **${timestamp}**: 摄入《${primaryDocTitle}》 -> 编译生成 ${conceptTitles.map((t) => `[[${t}]]`).join("、")}${draft.log_entry ? ` (${draft.log_entry})` : ""}\n`;
      logContent += logLine;
      fs.writeFileSync(logFilePath, logContent, "utf8");
      writtenFiles.push("00-Meta/log.md");

      return {
        ok: true,
        vaultRoot: resolvedRoot,
        writtenFiles,
        conceptsCount: draft.concepts.length,
        concepts: conceptTitles,
      };
    },
  };
}
