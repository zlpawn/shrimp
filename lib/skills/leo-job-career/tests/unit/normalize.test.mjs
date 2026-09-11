import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeJobFact } from "../../scripts/lib/normalize.mjs";

test("normalizeJobFact merges list and detail item into canonical job fact", () => {
  const listFixture = JSON.parse(fs.readFileSync("lib/skills/leo-job-career/tests/fixtures/search-list.json", "utf8"));
  const detailFixture = JSON.parse(fs.readFileSync("lib/skills/leo-job-career/tests/fixtures/job-detail-core.json", "utf8"));

  const rawItem = listFixture.zpData.jobList[0];
  const rawDetail = detailFixture.zpData;

  const fact = normalizeJobFact(rawItem, rawDetail);
  assert.equal(fact.schema_version, 1);
  assert.equal(fact.source, "boss");
  assert.equal(fact.source_job_id, "job_core_001");
  assert.equal(fact.canonical_key, "boss:job_core_001");
  assert.equal(fact.title, "AI平台Java后端架构师/专家");
  assert.ok(fact.description.includes("企业级智能体（Agent）中台"));
  assert.equal(fact.salary.annual_cash_min_cny, 600000); // 40K * 15
  assert.equal(fact.salary.annual_cash_max_cny, 900000); // 60K * 15
  assert.equal(fact.company.name, "智谱智能科技有限公司");
  assert.equal(fact.location.district, "海淀区");
  assert.equal(fact.location.business_district, "西北旺");
  assert.equal(fact.location.longitude, 116.23456);
  assert.equal(fact.recruiter.title, "技术总监");
  assert.equal(fact.recruiter.activity_raw, "刚刚活跃");
  assert.equal(fact.access.security_id, "sec_id_mock_001");
  assert.equal(fact.access.lid, "lid_mock_001");
  assert.equal(fact.observations.status, "active");
});
