import test from "node:test";
import assert from "node:assert/strict";
import { computeCanonicalKey, groupSemanticReposts } from "../../scripts/lib/dedupe.mjs";

test("computeCanonicalKey creates stable key", () => {
  assert.equal(computeCanonicalKey({ source: "boss", source_job_id: "abc123" }), "boss:abc123");
  assert.equal(computeCanonicalKey({ source_job_id: "def456" }), "boss:def456");
});

test("groupSemanticReposts identifies duplicate posts from the same company with similar titles and JD", () => {
  const jobs = [
    {
      canonical_key: "boss:j1",
      source_job_id: "j1",
      title: "Java Agent架构师",
      company: { name: "某AI公司" },
      salary: { raw: "35-50K·15薪" },
      description: "负责企业级Agent平台研发，基于RAG构建知识库系统，熟悉Spring Boot与MCP工具调用。",
      observations: { last_seen_at: "2026-09-10T10:00:00Z" }
    },
    {
      canonical_key: "boss:j2",
      source_job_id: "j2",
      title: "Java Agent后端专家",
      company: { name: "某AI公司" },
      salary: { raw: "35-50K·15薪" },
      description: "负责企业级Agent平台研发，基于RAG构建知识库系统，熟悉Spring Boot与MCP工具调用。",
      observations: { last_seen_at: "2026-09-11T10:00:00Z" }
    },
    {
      canonical_key: "boss:j3",
      source_job_id: "j3",
      title: "电商Java业务开发",
      company: { name: "某AI公司" },
      salary: { raw: "25-35K·14薪" },
      description: "负责电商主站订单与支付业务研发，高并发库存扣减。",
      observations: { last_seen_at: "2026-09-11T10:00:00Z" }
    }
  ];

  const result = groupSemanticReposts(jobs);
  assert.equal(result.uniqueJobs.length, 2);
  assert.equal(result.repostGroups.size, 1);
  const repostGroup = Array.from(result.repostGroups.values())[0];
  assert.equal(repostGroup.length, 2);
});
