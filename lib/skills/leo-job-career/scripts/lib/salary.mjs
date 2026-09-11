export function parseSalary(salaryDesc) {
  if (!salaryDesc || typeof salaryDesc !== "string") {
    return {
      raw: "",
      monthly_min_cny: null,
      monthly_max_cny: null,
      salary_months: null,
      annual_cash_min_cny: null,
      annual_cash_max_cny: null,
      uncertainties: ["missing_salary_description"],
    };
  }

  const raw = salaryDesc.trim();
  const uncertainties = [];

  if (raw.includes("天") || raw.includes("小时") || raw.includes("面议") || raw.includes("时薪")) {
    uncertainties.push("non_standard_unit");
    return {
      raw,
      monthly_min_cny: null,
      monthly_max_cny: null,
      salary_months: null,
      annual_cash_min_cny: null,
      annual_cash_max_cny: null,
      uncertainties,
    };
  }

  let salary_months = null;
  const monthMatch = raw.match(/[·*\s](\d+)薪/);
  if (monthMatch) {
    salary_months = parseInt(monthMatch[1], 10);
  }

  // Look for ranges like "35-50K" or "35-50k" or "3-5万"
  let monthly_min_cny = null;
  let monthly_max_cny = null;

  const kMatch = raw.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[Kk]/);
  const wanMatch = raw.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*万/);

  if (kMatch) {
    monthly_min_cny = Math.round(parseFloat(kMatch[1]) * 1000);
    monthly_max_cny = Math.round(parseFloat(kMatch[2]) * 1000);
  } else if (wanMatch) {
    monthly_min_cny = Math.round(parseFloat(wanMatch[1]) * 10000);
    monthly_max_cny = Math.round(parseFloat(wanMatch[2]) * 10000);
  } else {
    uncertainties.push("unrecognized_salary_range");
  }

  let annual_cash_min_cny = null;
  let annual_cash_max_cny = null;

  if (monthly_min_cny !== null && monthly_max_cny !== null) {
    if (salary_months !== null) {
      annual_cash_min_cny = monthly_min_cny * salary_months;
      annual_cash_max_cny = monthly_max_cny * salary_months;
    } else {
      uncertainties.push("salary_months_unknown");
    }
  }

  return {
    raw,
    monthly_min_cny,
    monthly_max_cny,
    salary_months,
    annual_cash_min_cny,
    annual_cash_max_cny,
    uncertainties,
  };
}
