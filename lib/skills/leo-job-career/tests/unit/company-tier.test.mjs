import test from "node:test";
import assert from "node:assert/strict";
import { classifyCompanyTier } from "../../scripts/lib/company-tier.mjs";

test("classifyCompanyTier dynamically classifies Big Tech by scale and listing", () => {
  const job = {
    title: "Java技术专家",
    company: { name: "某上市科技集团", size: "10000人以上", financing_stage: "已上市", industry: "互联网" },
    salary: { annual_cash_max_cny: 800000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "big_tech");
  assert.equal(res.tier_label, "大厂");
  assert.equal(res.is_reputable, true);
});

test("classifyCompanyTier recognizes seed Big Tech companies even without complete scale info", () => {
  const job = {
    title: "Java架构师",
    company: { name: "美团", size: "", financing_stage: "", industry: "互联网" },
    salary: { annual_cash_max_cny: 750000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "big_tech");
  assert.equal(res.is_reputable, true);
});

test("classifyCompanyTier dynamically classifies Mid Tech by scale and round", () => {
  const job = {
    title: "Java Agent后端",
    company: { name: "某成熟数字科技", size: "1000-9999人", financing_stage: "D轮及以上", industry: "互联网" },
    salary: { annual_cash_max_cny: 600000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "mid_tech");
  assert.equal(res.tier_label, "中厂");
  assert.equal(res.is_reputable, true);
});

test("classifyCompanyTier classifies Star Startup with venture funding and high salary", () => {
  const job = {
    title: "AI Agent研发专家",
    company: { name: "智谱华章", size: "100-499人", financing_stage: "B轮", industry: "人工智能" },
    salary: { annual_cash_min_cny: 400000, annual_cash_max_cny: 700000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "star_startup");
  assert.equal(res.tier_label, "知名AI创企");
  assert.equal(res.is_reputable, true);
});

test("classifyCompanyTier rejects unbacked micro workshop without funding", () => {
  const job = {
    title: "Java工程师",
    company: { name: "某微型工作室", size: "0-20人", financing_stage: "未融资", industry: "企业服务" },
    salary: { annual_cash_max_cny: 200000 },
  };
  const res = classifyCompanyTier(job);
  assert.equal(res.tier, "other");
  assert.equal(res.is_reputable, false);
});
