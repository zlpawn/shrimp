import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  stripCodeFence,
  extractJsonObject,
  sanitizeFileName,
  getAvailableChatModels,
  readExistingVaultConcepts,
  buildCompilerPrompt,
  buildRefinePrompt,
  createKarpathyCompiler,
} from "../../lib/knowledge-base/karpathy-compiler.mjs";

test("KarpathyCompiler: stripCodeFence and extractJsonObject", () => {
  const jsonStr = '{"summary":"ok","concepts":[{"title":"Test"}]}';
  assert.equal(stripCodeFence(jsonStr), jsonStr);

  const fenced = `\`\`\`json\n${jsonStr}\n\`\`\``;
  assert.equal(stripCodeFence(fenced), jsonStr);

  const parsed = extractJsonObject(fenced);
  assert.deepEqual(parsed, { summary: "ok", concepts: [{ title: "Test" }] });

  const withSurrounding = `Here is the output:\n\`\`\`json\n${jsonStr}\n\`\`\`\nHope this helps!`;
  const parsedSurrounding = extractJsonObject(withSurrounding);
  assert.deepEqual(parsedSurrounding, { summary: "ok", concepts: [{ title: "Test" }] });
});

test("KarpathyCompiler: sanitizeFileName", () => {
  assert.equal(sanitizeFileName("Valid Concept"), "Valid Concept");
  assert.equal(sanitizeFileName('Invalid/Concept:Name*?"<>|'), "Invalid_Concept_Name______");
  assert.equal(sanitizeFileName(""), "untitled");
});

test("KarpathyCompiler: getAvailableChatModels extracts models from config", () => {
  const mockConfig = {
    clients: {
      code: {
        endpoints: [
          {
            id: "ep-doubao",
            name: "火山引擎",
            models: ["glm-5.2", "deepseek-v4-pro"],
            is_default: true,
            enabled: true,
          },
          {
            id: "ep-disabled",
            name: "已停用节点",
            models: ["old-model"],
            enabled: false,
          },
          {
            id: "ep-emb",
            name: "向量节点",
            models: ["text-embedding-3"],
            purpose: "embedding",
            enabled: true,
          },
        ],
      },
      chat: {
        endpoints: [
          {
            id: "ep-grok",
            name: "xAI",
            models: ["grok-4.5"],
            purpose: "chat",
            enabled: true,
          },
        ],
      },
    },
  };

  const models = getAvailableChatModels(mockConfig);
  assert.equal(models.length, 3);
  assert.equal(models[0].model, "glm-5.2");
  assert.equal(models[0].client, "code");
  assert.equal(models[0].isDefault, true);
  assert.equal(models[1].model, "deepseek-v4-pro");
  assert.equal(models[2].model, "grok-4.5");
  assert.equal(models[2].client, "chat");

  // Fallback when empty
  const fallback = getAvailableChatModels({});
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].model, "glm-5.2");
});

test("KarpathyCompiler: readExistingVaultConcepts reads wiki/*.md", () => {
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), "kb_test_vault_"));
  try {
    const wikiDir = path.join(tempVault, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, "滑坡谬误.md"), "# 滑坡谬误");
    fs.writeFileSync(path.join(wikiDir, "归纳偏差.md"), "# 归纳偏差");
    fs.writeFileSync(path.join(wikiDir, "not-markdown.txt"), "text");

    const concepts = readExistingVaultConcepts(tempVault);
    assert.deepEqual(concepts.sort(), ["归纳偏差", "滑坡谬误"].sort());

    // Nonexistent vault returns empty array
    assert.deepEqual(readExistingVaultConcepts(path.join(tempVault, "nonexistent")), []);
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

test("KarpathyCompiler: buildCompilerPrompt weaves existing concepts", () => {
  const promptEmpty = buildCompilerPrompt([]);
  assert.ok(promptEmpty.includes("当前 Obsidian Vault 暂无历史概念"));

  const promptExisting = buildCompilerPrompt(["滑坡谬误", "第一性原理"]);
  assert.ok(promptExisting.includes("- [[滑坡谬误]]"));
  assert.ok(promptExisting.includes("- [[第一性原理]]"));
  assert.ok(promptExisting.includes("Stop retrieving. Start compiling."));
});

test("KarpathyCompiler: applyDraftToVault generates offline self-contained Obsidian Vault", () => {
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), "kb_vault_apply_"));
  const tempKbData = fs.mkdtempSync(path.join(os.tmpdir(), "kb_data_apply_"));

  try {
    // Setup mock document with asset
    const docId = "doc_test_101";
    const docAssetsDir = path.join(tempKbData, "files", docId, "assets");
    fs.mkdirSync(docAssetsDir, { recursive: true });
    fs.writeFileSync(path.join(docAssetsDir, "diagram.png"), "mock-png-data");

    const mockDoc = {
      id: docId,
      title: "逻辑谬误与批判性思维",
      source_type: "craft_note",
      source_url: "craftdocs://open?blockId=123",
      markdown: "这里是关于逻辑谬误的论述，附图如下：\n\n![架构拓扑](/v1/kb/files/doc_test_101/assets/diagram.png)\n\n详见后文。",
    };

    const mockDraft = {
      summary: "从《逻辑谬误》中提炼出滑坡谬误与稻草人谬误两大决策缺陷模型",
      index_category: "认知与逻辑",
      log_entry: "提炼决策缺陷模型 -> 生成 [[滑坡谬误]] 与 [[稻草人谬误]]",
      concepts: [
        {
          title: "滑坡谬误",
          aliases: ["Slippery Slope"],
          category: "认知与逻辑",
          tags: ["逻辑学", "决策模型"],
          summary: "将微小初始事件不合理推导为灾难性极端后果的论证缺陷",
          content_markdown: "## 核心定义与本质\n滑坡谬误（[[Slippery Slope]]）是一种非形式逻辑谬误。\n\n## 运行机理\n由 A 强行推导至 Z，忽略中间缓冲节点。\n\n## 关联概念\n- [[稻草人谬误]]",
        },
        {
          title: "稻草人谬误",
          aliases: ["Strawman Fallacy"],
          category: "认知与逻辑",
          tags: ["逻辑学", "辩论学"],
          summary: "歪曲或夸大对方观点再进行攻击的反驳手段",
          content_markdown: "## 核心定义与本质\n故意树立一个易受攻击的假人。\n\n## 关联概念\n- [[滑坡谬误]]",
        },
      ],
    };

    const compiler = createKarpathyCompiler({
      config: {},
      dataDir: tempKbData,
      listenPort: 8787,
    });

    const result = compiler.applyDraftToVault({
      draft: mockDraft,
      documents: [mockDoc],
      vaultRoot: tempVault,
      kbDataDir: tempKbData,
    });

    assert.equal(result.ok, true);
    assert.equal(result.conceptsCount, 2);

    // 1. Verify raw/ material was written with relative asset path
    const today = new Date().toISOString().slice(0, 10);
    const rawFiles = fs.readdirSync(path.join(tempVault, "raw"));
    assert.ok(rawFiles.some((f) => f.includes("逻辑谬误与批判性思维.md")));
    const rawContent = fs.readFileSync(path.join(tempVault, "raw", rawFiles.find((f) => f.includes("逻辑谬误"))), "utf8");
    assert.ok(rawContent.includes("status: \"immutable_raw\""));
    // Assert link was rewritten to relative assets/
    assert.ok(rawContent.includes("assets/diagram.png"));
    assert.ok(!rawContent.includes("/v1/kb/files/"));

    // Verify asset was copied to raw/assets
    assert.ok(fs.existsSync(path.join(tempVault, "raw", "assets", "diagram.png")));

    // 2. Verify wiki/ concepts were written with frontmatter and wikilinks
    const wikiFiles = fs.readdirSync(path.join(tempVault, "wiki"));
    assert.ok(wikiFiles.includes("滑坡谬误.md"));
    assert.ok(wikiFiles.includes("稻草人谬误.md"));

    const slipperySlope = fs.readFileSync(path.join(tempVault, "wiki", "滑坡谬误.md"), "utf8");
    assert.ok(slipperySlope.includes('title: "滑坡谬误"'));
    assert.ok(slipperySlope.includes('compiled_by: "gateway-karpathy-compiler"'));
    assert.ok(slipperySlope.includes("[[稻草人谬误]]"));

    // 3. Verify 00-Meta/index.md (MOC)
    const indexContent = fs.readFileSync(path.join(tempVault, "00-Meta", "index.md"), "utf8");
    assert.ok(indexContent.includes("## 认知与逻辑"));
    assert.ok(indexContent.includes("- [[滑坡谬误]]"));
    assert.ok(indexContent.includes("- [[稻草人谬误]]"));

    // 4. Verify 00-Meta/log.md (Audit log)
    const logContent = fs.readFileSync(path.join(tempVault, "00-Meta", "log.md"), "utf8");
    assert.ok(logContent.includes("逻辑谬误与批判性思维"));
    assert.ok(logContent.includes("[[滑坡谬误]]"));
    assert.ok(logContent.includes("[[稻草人谬误]]"));

    // Test idempotent second apply
    const secondDraft = {
      summary: "追加一个概念",
      index_category: "认知与逻辑",
      log_entry: "追加新概念",
      concepts: [
        {
          title: "假两难推理",
          aliases: [],
          category: "认知与逻辑",
          tags: ["逻辑学"],
          summary: "人为制造非黑即白的选择困境",
          content_markdown: "## 核心定义\n非此即彼的极端化。",
        },
      ],
    };

    const secondResult = compiler.applyDraftToVault({
      draft: secondDraft,
      documents: [mockDoc],
      vaultRoot: tempVault,
      kbDataDir: tempKbData,
    });
    assert.equal(secondResult.ok, true);

    const updatedIndex = fs.readFileSync(path.join(tempVault, "00-Meta", "index.md"), "utf8");
    assert.ok(updatedIndex.includes("- [[假两难推理]]"));
    assert.ok(updatedIndex.includes("- [[滑坡谬误]]")); // Previous links preserved
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
    fs.rmSync(tempKbData, { recursive: true, force: true });
  }
});

test("KarpathyCompiler: routes handle /v1/kb/compile/* endpoints", async () => {
  const { createKbRoutes } = await import("../../lib/knowledge-base/routes.mjs");
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), "kb_route_vault_"));

  try {
    const mockStore = {
      getDocument: () => ({ id: "doc_1", title: "测试文章", markdown: "测试内容" }),
      listDocuments: () => [{ id: "doc_1", title: "测试文章", markdown: "测试内容" }],
    };

    const mockCompiler = {
      getModels: () => [{ model: "glm-5.2", client: "code", displayName: "GLM 5.2" }],
      compileDraft: async () => ({
        draft: { summary: "preview ok", concepts: [{ title: "概念1" }] },
      }),
      refineDraft: async () => ({
        draft: { summary: "refine ok", concepts: [{ title: "概念1 (已优化)" }] },
      }),
      applyDraftToVault: ({ draft, vaultRoot }) => ({
        ok: true,
        vaultRoot,
        writtenFiles: ["wiki/概念1.md"],
      }),
    };

    const routeHandler = createKbRoutes({
      store: mockStore,
      pipeline: {},
      registry: {},
      dataDir: "/tmp",
      compiler: mockCompiler,
    });

    const createMockRes = () => {
      let statusCode = 0;
      let headers = {};
      let body = "";
      return {
        writeHead: (code, h) => {
          statusCode = code;
          headers = h || {};
        },
        end: (data) => {
          body = data || "";
        },
        get statusCode() {
          return statusCode;
        },
        get body() {
          return body ? JSON.parse(body) : null;
        },
      };
    };

    // 1. GET /v1/kb/compile/models
    const resModels = createMockRes();
    const handledModels = await routeHandler(
      { method: "GET" },
      resModels,
      new URL("http://127.0.0.1/v1/kb/compile/models"),
      "/v1/kb/compile/models"
    );
    assert.equal(handledModels, true);
    assert.equal(resModels.statusCode, 200);
    assert.equal(resModels.body.models[0].model, "glm-5.2");

    // 2. POST /v1/kb/compile/preview
    const resPreview = createMockRes();
    const previewReq = {
      method: "POST",
      on: (event, handler) => {
        if (event === "data") handler(JSON.stringify({ document_ids: ["doc_1"] }));
        if (event === "end") handler();
      },
    };
    const handledPreview = await routeHandler(
      previewReq,
      resPreview,
      new URL("http://127.0.0.1/v1/kb/compile/preview"),
      "/v1/kb/compile/preview"
    );
    assert.equal(handledPreview, true);
    assert.equal(resPreview.statusCode, 200);
    assert.equal(resPreview.body.draft.summary, "preview ok");

    // 3. POST /v1/kb/compile/refine
    const resRefine = createMockRes();
    const refineReq = {
      method: "POST",
      on: (event, handler) => {
        if (event === "data")
          handler(
            JSON.stringify({
              draft: { summary: "preview ok", concepts: [{ title: "概念1" }] },
              feedback: "加点例子",
            })
          );
        if (event === "end") handler();
      },
    };
    const handledRefine = await routeHandler(
      refineReq,
      resRefine,
      new URL("http://127.0.0.1/v1/kb/compile/refine"),
      "/v1/kb/compile/refine"
    );
    assert.equal(handledRefine, true);
    assert.equal(resRefine.statusCode, 200);
    assert.equal(resRefine.body.draft.summary, "refine ok");

    // 4. POST /v1/kb/compile/apply
    const resApply = createMockRes();
    const applyReq = {
      method: "POST",
      on: (event, handler) => {
        if (event === "data")
          handler(
            JSON.stringify({
              draft: { summary: "refine ok", concepts: [{ title: "概念1" }] },
              vault_root: tempVault,
            })
          );
        if (event === "end") handler();
      },
    };
    const handledApply = await routeHandler(
      applyReq,
      resApply,
      new URL("http://127.0.0.1/v1/kb/compile/apply"),
      "/v1/kb/compile/apply"
    );
    assert.equal(handledApply, true);
    assert.equal(resApply.statusCode, 200);
    assert.equal(resApply.body.ok, true);
  } finally {
    fs.rmSync(tempVault, { recursive: true, force: true });
  }
});

