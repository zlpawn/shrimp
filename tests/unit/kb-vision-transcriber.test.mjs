import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseVisionResponse,
  buildEvidenceCardHtml,
  buildVisionPrompt,
  formatTimestamp,
} from "../../lib/knowledge-base/vision-transcriber.mjs";

describe("Vision Transcriber & Evidence Card", () => {
  it("parses Mermaid diagrams, tables, and bullet points from LLM output", () => {
    const rawOutput = `
这是一张系统架构流程图。

\`\`\`mermaid
flowchart TD
    Client[客户端] --> Gateway[API网关]
    Gateway --> Service[核心服务]
    Service --> DB[(数据库)]
\`\`\`

| 组件 | 作用 | 协议 |
| --- | --- | --- |
| Gateway | 鉴权分发 | HTTPS |
| Service | 业务计算 | gRPC |

> 💡 **核心信息提炼**：
- 1. 客户端通过网关层进行统一安全鉴权。
- 2. 内部服务间通信采用 gRPC 高性能 RPC 协议。
`;

    const parsed = parseVisionResponse(rawOutput);
    assert.ok(parsed.hasMermaid);
    assert.ok(parsed.mermaidCode.includes("Client[客户端] --> Gateway[API网关]"));
    assert.ok(parsed.hasTable);
    assert.ok(parsed.tableMarkdown.includes("| Gateway | 鉴权分发 | HTTPS |"));
    assert.equal(parsed.bulletPoints.length, 2);
    assert.ok(parsed.bulletPoints[0].includes("客户端通过网关层"));
  });

  it("builds a traceable Evidence Card HTML with raw asset and fold details", () => {
    const cardHtml = buildEvidenceCardHtml({
      assetUrl: "/v1/kb/files/doc123/assets/arch.png",
      filename: "arch.png",
      title: "系统架构图",
      sourceType: "doc",
      timestampOrPage: "第 3 页",
      mermaidCode: "flowchart TD\n  A --> B",
      bulletPoints: ["服务通过网关分发", "数据库读写分离"],
    });

    assert.ok(cardHtml.includes('class="kb-evidence-card"'));
    assert.ok(cardHtml.includes('data-asset="arch.png"'));
    assert.ok(cardHtml.includes('data-source-type="doc"'));
    assert.ok(cardHtml.includes("📸 原始物理凭证"));
    assert.ok(cardHtml.includes("📄 文档位置 [第 3 页]"));
    assert.ok(cardHtml.includes('src="/v1/kb/files/doc123/assets/arch.png"'));
    assert.ok(cardHtml.includes('details open class="kb-evidence-details"'));
    assert.ok(cardHtml.includes("```mermaid"));
    assert.ok(cardHtml.includes("flowchart TD\n  A --> B"));
    assert.ok(cardHtml.includes("🔍 查看原图"));
  });

  it("builds video evidence card with timestamp badge", () => {
    const cardHtml = buildEvidenceCardHtml({
      assetUrl: "/v1/video-kb/videos/v123/frames/frame_0005.jpg",
      filename: "frame_0005.jpg",
      title: "PPT 架构讲解",
      sourceType: "video",
      timestampOrPage: "04:18",
      interpretation: "讲者正在板书消息队列的可靠投递模型。",
    });

    assert.ok(cardHtml.includes("⏱️ 关键帧 [04:18]"));
    assert.ok(cardHtml.includes("讲者正在板书消息队列的可靠投递模型。"));
  });

  it("builds appropriate vision prompts", () => {
    const docPrompt = buildVisionPrompt({
      title: "分布式事务",
      sourceType: "doc",
      timestampOrPage: "第 12 页",
    });
    assert.ok(docPrompt.includes("技术文档 [第 12 页]"));
    assert.ok(docPrompt.includes("分布式事务"));

    const videoPrompt = buildVisionPrompt({
      title: "架构设计",
      sourceType: "video",
      timestampOrPage: "08:30",
    });
    assert.ok(videoPrompt.includes("视频在时间戳 [08:30]"));
  });

  it("formats seconds to timestamp string", () => {
    assert.equal(formatTimestamp(125), "02:05");
    assert.equal(formatTimestamp(3605), "01:00:05");
  });
});
