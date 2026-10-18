import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STRATEGIES_DIR = path.resolve(__dirname, "../../strategies");

export function listStrategies() {
  if (!fs.existsSync(STRATEGIES_DIR)) return [];
  const files = fs.readdirSync(STRATEGIES_DIR).filter(f => f.endsWith(".json"));
  return files.map(f => {
    try {
      const content = JSON.parse(fs.readFileSync(path.join(STRATEGIES_DIR, f), "utf8"));
      return {
        id: content.id || f.replace(".json", ""),
        name: content.name,
        description: content.description,
        file: f,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export function loadStrategy(strategyNameOrRole = null) {
  if (!fs.existsSync(STRATEGIES_DIR)) {
    return null;
  }

  const files = fs.readdirSync(STRATEGIES_DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) return null;

  // 1. Direct match by id or filename
  if (strategyNameOrRole) {
    const clean = strategyNameOrRole.toLowerCase().trim();
    for (const file of files) {
      if (file.toLowerCase().replace(".json", "") === clean) {
        return JSON.parse(fs.readFileSync(path.join(STRATEGIES_DIR, file), "utf8"));
      }
    }

    // 2. Match by target_role_patterns
    for (const file of files) {
      try {
        const strategy = JSON.parse(fs.readFileSync(path.join(STRATEGIES_DIR, file), "utf8"));
        if (strategy.id?.toLowerCase() === clean) return strategy;
        const patterns = strategy.target_role_patterns || [];
        if (patterns.some(p => clean.includes(p.toLowerCase()) || p.toLowerCase().includes(clean))) {
          return strategy;
        }
      } catch {}
    }
  }

  // 3. Fallback to default strategy (java-to-ai-agent.json if present, or first json)
  const defaultFile = files.find(f => f === "java-to-ai-agent.json") || files[0];
  return JSON.parse(fs.readFileSync(path.join(STRATEGIES_DIR, defaultFile), "utf8"));
}

export function evaluateDisambiguation(job, strategy) {
  if (!strategy?.disambiguation) return { excluded: false };
  const { negative_patterns = [], positive_llm_terms = [], negative_action } = strategy.disambiguation;

  const text = `${job.title || ""} ${job.description || ""} ${(job.requirements?.labels || []).join(" ")}`.toLowerCase();

  const hitNegative = negative_patterns.filter(p => text.includes(p.toLowerCase()));
  if (hitNegative.length === 0) {
    return { excluded: false };
  }

  // If hits negative patterns (e.g. -javaagent, skywalking, 字节码插桩), check if there are positive LLM terms
  if (negative_action === "exclude_if_no_llm_terms") {
    const hitPositive = positive_llm_terms.filter(t => text.includes(t.toLowerCase()));
    if (hitPositive.length === 0) {
      return {
        excluded: true,
        reasons: [`[semantic_disambiguation] 命中领域消歧负向关键词（${hitNegative.join(", ")}），且未包含任何大模型核心术语`],
      };
    }
  }

  return { excluded: false };
}
