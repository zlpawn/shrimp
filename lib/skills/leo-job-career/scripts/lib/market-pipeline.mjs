import { normalizeJobFact } from "./normalize.mjs";
import { groupSemanticReposts, computeCanonicalKey } from "./dedupe.mjs";
import {
  evaluateFreshness,
  detectDeterministicExclusions,
  evaluateJavaRelevance,
  evaluateAgentRelevance,
} from "./freshness.mjs";

export const DEFAULT_SEARCH_FAMILIES = [
  "Java Agent",
  "Java 智能体",
  "Java 大模型",
  "Java 大模型应用",
  "Java RAG",
  "Java 知识库",
  "Java MCP",
  "Java AI 应用",
  "AI 平台 后端 Java",
  "大模型平台 后端 Java",
  "AI 应用 技术负责人",
  "AI 研发经理 Java",
  "Java 技术专家 大模型",
];

export async function executeMarketRun(options = {}) {
  const { paths, client, runStore, jobStore } = options;
  const target = options.target || 100;
  const city = options.city || "北京";
  const searchQueries = options.searchQueries || DEFAULT_SEARCH_FAMILIES;

  let run = runStore.getLatestResumableRun();
  if (!run) {
    run = runStore.createRun({ city, target });
  }

  runStore.updateProgress(run.run_id, { stage: "collecting_lists" });

  const collectedFacts = [];
  const seenCanonicalKeys = new Set();
  const existingFacts = jobStore.loadJobFacts();
  for (const f of existingFacts) {
    seenCanonicalKeys.add(f.canonical_key);
  }

  let candidatesSeen = run.stats?.candidates_seen || 0;
  let detailsFetched = run.stats?.details_fetched || 0;
  let excludedOutsourcing = run.stats?.excluded_outsourcing || 0;
  let exactDupes = run.stats?.exact_dupes || 0;

  let queryIndex = run.search_plan_index || 0;

  try {
    for (; queryIndex < searchQueries.length; queryIndex++) {
      const query = searchQueries[queryIndex];
      let page = 1;
      let hasMore = true;

      while (hasMore && collectedFacts.length < target && page <= 5) {
        runStore.updateProgress(run.run_id, {
          search_plan_index: queryIndex,
          page_index: page,
          stats: {
            candidates_seen: candidatesSeen,
            details_fetched: detailsFetched,
            valid_jobs: collectedFacts.length,
            excluded_outsourcing: excludedOutsourcing,
            exact_dupes: exactDupes,
          },
        });

        const listResult = await client.searchJobs({ query, city: "101010100", page });
        jobStore.saveRawSearch(`query_${queryIndex}`, page, listResult.raw || listResult);

        const items = listResult.jobList || [];
        if (items.length === 0) break;
        hasMore = listResult.hasMore;

        for (const item of items) {
          candidatesSeen++;
          const canonicalKey = computeCanonicalKey(item);

          if (seenCanonicalKeys.has(canonicalKey)) {
            exactDupes++;
            continue;
          }
          seenCanonicalKeys.add(canonicalKey);

          // Coarse quick filter for outsourcing & non-java
          const coarseExclusion = detectDeterministicExclusions({
            title: item.jobName,
            requirements: { labels: item.jobLabels || [] },
            company: { name: item.brandName, industry: item.brandIndustry },
          });

          if (coarseExclusion.excluded) {
            excludedOutsourcing++;
            continue;
          }

          const javaRel = evaluateJavaRelevance({
            title: item.jobName,
            requirements: { labels: item.jobLabels || [] },
          });

          if (javaRel.level === "python_only") {
            continue;
          }

          // Fetch full detail
          try {
            const detail = await client.getJobDetail({
              securityId: item.securityId,
              lid: item.lid,
              jobId: item.encryptJobId,
            });
            detailsFetched++;
            jobStore.saveRawDetail(item.encryptJobId, detail);

            const fact = normalizeJobFact(item, detail);

            // Strict exclusion check on full JD
            const fullExclusion = detectDeterministicExclusions(fact);
            if (fullExclusion.excluded) {
              excludedOutsourcing++;
              continue;
            }

            const fullJavaRel = evaluateJavaRelevance(fact);
            if (fullJavaRel.level === "python_only" || fullJavaRel.level === "minor") {
              continue;
            }

            const agentRel = evaluateAgentRelevance(fact);
            if (agentRel.level === "none") {
              continue;
            }

            collectedFacts.push(fact);
            if (collectedFacts.length >= target) break;
          } catch (err) {
            if (["AUTH_REQUIRED", "SECURITY_CHECK_REQUIRED", "RATE_LIMITED"].includes(err.code)) {
              runStore.updateProgress(run.run_id, {
                stage: `paused_${err.code.toLowerCase()}`,
                error: err.message,
              });
              throw err;
            }
            // continue on single job fetch failure
          }
        }

        page++;
      }

      if (collectedFacts.length >= target) break;
    }

    // Semantic dedupe
    const dedupeResult = groupSemanticReposts(collectedFacts);
    const finalFacts = dedupeResult.uniqueJobs;

    // Save canonical facts
    jobStore.saveJobFacts(finalFacts);

    const finalStage = finalFacts.length >= target ? "complete" : "complete_below_target";
    const finalStats = {
      candidates_seen: candidatesSeen,
      details_fetched: detailsFetched,
      valid_jobs: finalFacts.length,
      excluded_outsourcing: excludedOutsourcing,
      exact_dupes: exactDupes,
      semantic_reposts: dedupeResult.repostGroups.size,
    };

    runStore.updateProgress(run.run_id, {
      stage: finalStage,
      stats: finalStats,
    });

    runStore.saveSummary(run.run_id, {
      run_id: run.run_id,
      stage: finalStage,
      stats: finalStats,
      completed_at: new Date().toISOString(),
    });

    return {
      ok: true,
      run_id: run.run_id,
      stage: finalStage,
      stats: finalStats,
      jobs: finalFacts,
    };
  } catch (err) {
    runStore.updateProgress(run.run_id, {
      stage: `paused_${err.code ? err.code.toLowerCase() : "failed"}`,
      error: err.message,
    });
    throw err;
  }
}

export function classifyRoleFamily(job) {
  const title = (job.title || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();

  if (/负责人|leader|主管|经理|带队/.test(title) || /团队管理|业务交付|带队经验/.test(desc)) {
    if (/架构|方案|核心研发|技术/.test(title)) {
      return "technical_lead";
    }
    return "technical_management";
  }

  if (/平台|基础|运行时|runtime|网关|基建|中间件/.test(title) || /agent平台|智能体平台|模型网关|agent runtime/.test(desc)) {
    return "agent_platform_infrastructure";
  }

  return "ai_application_backend";
}

export function generateMarketReport(options = {}) {
  const { jobStore } = options;
  const facts = jobStore.loadJobFacts();

  const roleFamilies = {
    ai_application_backend: 0,
    agent_platform_infrastructure: 0,
    technical_lead: 0,
    technical_management: 0,
    weak_or_adjacent_ai: 0,
  };

  const capabilityCounts = new Map();
  const companySeen = new Set();
  const annualSalaries = [];
  let meetingTargetBandCount = 0; // >= 60w

  for (const job of facts) {
    companySeen.add(job.company?.name);

    const family = classifyRoleFamily(job);
    roleFamilies[family] = (roleFamilies[family] || 0) + 1;

    // Salary stats
    if (job.salary?.annual_cash_max_cny) {
      annualSalaries.push({
        min: job.salary.annual_cash_min_cny,
        max: job.salary.annual_cash_max_cny,
        raw: job.salary.raw,
      });
      if (job.salary.annual_cash_max_cny >= 600000) {
        meetingTargetBandCount++;
      }
    }

    // Extract capability labels
    const labels = job.requirements?.labels || [];
    for (const label of labels) {
      const clean = label.trim();
      if (!clean) continue;
      capabilityCounts.set(clean, (capabilityCounts.get(clean) || 0) + 1);
    }
  }

  const sortedCapabilities = Array.from(capabilityCounts.entries())
    .map(([skill, count]) => ({ skill, count, frequency: Math.round((count / (facts.length || 1)) * 100) }))
    .sort((a, b) => b.count - a.count);

  return {
    total_valid_jobs: facts.length,
    unique_companies_count: companySeen.size,
    role_families: roleFamilies,
    compensation_overview: {
      with_explicit_annual_count: annualSalaries.length,
      meeting_60_to_70w_target_count: meetingTargetBandCount,
      target_band_percentage: facts.length ? Math.round((meetingTargetBandCount / facts.length) * 100) : 0,
    },
    capability_matrix: sortedCapabilities.slice(0, 20),
  };
}
