import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * 测前静态划界探针 (Scope Diff Probe)
 * 移植自 gstack: git diff 自动锁定改动范围并提取页面、接口与组件特征
 */
export function analyzeDiffScope(baseBranch = "main") {
  let diffFiles = [];
  let gitLogs = [];

  try {
    const diffRaw = execSync(`git diff ${baseBranch}...HEAD --name-only`, { encoding: "utf-8" }).trim();
    if (diffRaw) {
      diffFiles = diffRaw.split("\n").map((f) => f.trim()).filter(Boolean);
    }
  } catch {
    try {
      // 降级使用工作区未提交文件对比
      const statusRaw = execSync("git status --short", { encoding: "utf-8" }).trim();
      if (statusRaw) {
        diffFiles = statusRaw
          .split("\n")
          .map((line) => line.slice(3).trim())
          .filter(Boolean);
      }
    } catch {
      diffFiles = [];
    }
  }

  try {
    const logRaw = execSync(`git log ${baseBranch}..HEAD --oneline -n 10`, { encoding: "utf-8" }).trim();
    if (logRaw) {
      gitLogs = logRaw.split("\n").map((l) => l.trim()).filter(Boolean);
    }
  } catch {
    gitLogs = [];
  }

  const scope = {
    totalFiles: diffFiles.length,
    files: diffFiles,
    commits: gitLogs,
    surfaces: {
      routes: [],
      controllers: [],
      apis: [],
      views: [],
      tests: [],
      services: [],
    },
    suggestedModes: [],
  };

  // 模式与特征推导
  for (const file of diffFiles) {
    const ext = path.extname(file).toLowerCase();
    const lower = file.toLowerCase();

    if (lower.includes("test") || lower.includes("spec") || ext === ".test.ts" || ext === ".spec.js") {
      scope.surfaces.tests.push(file);
    } else if (lower.includes("controller") || lower.includes("router") || lower.includes("route")) {
      scope.surfaces.controllers.push(file);
    } else if (lower.includes("api") || lower.includes("endpoint")) {
      scope.surfaces.apis.push(file);
    } else if (
      lower.includes("view") ||
      lower.includes("page") ||
      ext === ".vue" ||
      ext === ".tsx" ||
      ext === ".jsx" ||
      ext === ".html"
    ) {
      scope.surfaces.views.push(file);
    } else if (lower.includes("service") || lower.includes("model") || lower.includes("dao")) {
      scope.surfaces.services.push(file);
    }
  }

  // 推荐模式判定
  if (scope.surfaces.views.length > 0) {
    scope.suggestedModes.push("e2e");
  }
  if (scope.surfaces.tests.length > 0 || scope.surfaces.services.length > 0) {
    scope.suggestedModes.push("unit");
  }
  if (scope.surfaces.controllers.length > 0 || scope.surfaces.apis.length > 0) {
    scope.suggestedModes.push("api");
  }
  if (scope.suggestedModes.length === 0) {
    scope.suggestedModes.push("e2e", "unit");
  }

  return scope;
}

if (process.argv[1] && process.argv[1].endsWith("scope_diff.mjs")) {
  const base = process.argv[2] || "main";
  const result = analyzeDiffScope(base);
  console.log(JSON.stringify(result, null, 2));
}
