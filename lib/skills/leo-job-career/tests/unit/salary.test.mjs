import test from "node:test";
import assert from "node:assert/strict";
import { parseSalary } from "../../scripts/lib/salary.mjs";

test("parseSalary handles standard 15-month salary", () => {
  const res = parseSalary("35-50K·15薪");
  assert.equal(res.raw, "35-50K·15薪");
  assert.equal(res.monthly_min_cny, 35000);
  assert.equal(res.monthly_max_cny, 50000);
  assert.equal(res.salary_months, 15);
  assert.equal(res.annual_cash_min_cny, 525000);
  assert.equal(res.annual_cash_max_cny, 750000);
  assert.deepEqual(res.uncertainties, []);
});

test("parseSalary handles salary without month count without guessing annual", () => {
  const res = parseSalary("30-45K");
  assert.equal(res.raw, "30-45K");
  assert.equal(res.monthly_min_cny, 30000);
  assert.equal(res.monthly_max_cny, 45000);
  assert.equal(res.salary_months, null);
  assert.equal(res.annual_cash_min_cny, null);
  assert.equal(res.annual_cash_max_cny, null);
  assert.deepEqual(res.uncertainties, ["salary_months_unknown"]);
});

test("parseSalary handles Yuan/day or negotiable", () => {
  const res = parseSalary("150-200元/天");
  assert.equal(res.monthly_min_cny, null);
  assert.equal(res.annual_cash_min_cny, null);
  assert.ok(res.uncertainties.includes("non_standard_unit"));
});

test("parseSalary handles 16-month high salary", () => {
  const res = parseSalary("50-70K·16薪");
  assert.equal(res.monthly_min_cny, 50000);
  assert.equal(res.monthly_max_cny, 70000);
  assert.equal(res.salary_months, 16);
  assert.equal(res.annual_cash_min_cny, 800000);
  assert.equal(res.annual_cash_max_cny, 1120000);
});
