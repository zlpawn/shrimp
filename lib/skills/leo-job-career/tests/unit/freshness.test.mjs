import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFreshness, detectDeterministicExclusions, evaluateJavaRelevance, evaluateAgentRelevance } from "../../scripts/lib/freshness.mjs";

test("evaluateFreshness grades recently active jobs as A or B", () => {
  const activeJob = {
    recruiter: { activity_raw: "今日活跃" },
    observations: { status: "active", last_seen_at: new Date().toISOString() }
  };
  const res = evaluateFreshness(activeJob);
  assert.equal(res.grade, "A");
  assert.ok(res.confidence >= 0.8);
});

test("detectDeterministicExclusions catches outsourcing and labor dispatch keywords", () => {
  const normalJob = {
    title: "Java 后端专家",
    description: "负责平台核心研发",
    company: { name: "自研科技", industry: "互联网" }
  };
  assert.equal(detectDeterministicExclusions(normalJob).excluded, false);

  const outsourcingJob = {
    title: "Java开发（外派大厂）",
    description: "要求驻场客户现场办公，介意外包勿投",
    company: { name: "某人力资源服务有限公司", industry: "人力资源服务" }
  };
  const outRes = detectDeterministicExclusions(outsourcingJob);
  assert.equal(outRes.excluded, true);
  assert.ok(outRes.reasons.some(r => r.includes("外派") || r.includes("驻场") || r.includes("人力资源")));
});

test("evaluateJavaRelevance classifies Java priority vs Python-only", () => {
  const javaJob = {
    title: "AI平台Java后端架构师",
    requirements: { labels: ["Java", "Spring Boot", "RAG"] },
    description: "主语言为Java，深入理解Spring Cloud与JVM"
  };
  assert.equal(evaluateJavaRelevance(javaJob).level, "primary");

  const pythonJob = {
    title: "大模型算法研究员",
    requirements: { labels: ["Python", "PyTorch"] },
    description: "精通Python与深度学习框架，无Java要求"
  };
  assert.equal(evaluateJavaRelevance(pythonJob).level, "python_only");
});

test("evaluateAgentRelevance detects core Agent keywords vs keyword-only", () => {
  const coreAgentJob = {
    title: "Java智能体后端开发",
    requirements: { labels: ["Agent", "RAG", "MCP"] },
    description: "负责企业级Agent工作流编排、工具调用Function Calling与知识库RAG平台建设"
  };
  assert.equal(evaluateAgentRelevance(coreAgentJob).level, "core");

  const weakJob = {
    title: "Java资深开发",
    requirements: { labels: ["Java", "MySQL"] },
    description: "负责后台CRM管理系统开发。有AI或大模型使用经验者优先考虑。"
  };
  assert.equal(evaluateAgentRelevance(weakJob).level, "keyword_only");
});
