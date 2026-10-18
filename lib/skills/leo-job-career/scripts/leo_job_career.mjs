#!/usr/bin/env node
import { parseCliArgs, formatSuccess, formatError, executeDoctor } from "./lib/cli.mjs";
import { resolveRuntimePaths, ensureRuntimeDirectories } from "./lib/config.mjs";
import {
  loadAuthState,
  importFromClipboard,
  importCookieHeader,
  importFromFile,
  loadRawCookieHeader,
  importFromBridge,
} from "./lib/auth.mjs";

import { BossClient } from "./lib/boss-client.mjs";
import { RunStore } from "./lib/run-store.mjs";
import { JobStore } from "./lib/job-store.mjs";
import { executeMarketRun, generateMarketReport } from "./lib/market-pipeline.mjs";
import {
  initCareerProfile,
  loadCareerProfile,
  updateCareerProfile,
} from "./lib/profile-engine.mjs";
import {
  analyzeCapabilityGaps,
  generateMarkdownGapReport,
  saveMarkdownGapReport,
} from "./lib/gap-analyzer.mjs";

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseCliArgs(args);
  const paths = resolveRuntimePaths();
  ensureRuntimeDirectories(paths);

  const command = parsed.command || "doctor";
  const subcommand = parsed.subcommand;
  const runStore = new RunStore({ paths });
  const jobStore = new JobStore({ paths });

  try {
    switch (command) {
      case "doctor": {
        const res = executeDoctor({ paths });
        console.log(JSON.stringify(res, null, 2));
        break;
      }
      case "auth": {
        switch (subcommand || "status") {
          case "status": {
            const state = loadAuthState({ paths });
            const data = {
              has_auth: state.status === "valid" || state.status === "imported",
              status: state.status,
              domain: state.domain,
              source: state.source,
              cookie_count: state.cookie_count,
              cookie_names: state.cookie_names,
              imported_at: state.imported_at,
              last_verified_at: state.last_verified_at,
            };
            const warnings = [];
            const next_actions = [];
            if (!data.has_auth) {
              warnings.push("Authentication missing.");
              next_actions.push("Copy Cookie Header using Leo cookie.txt Locally browser extension, then run auth import-clipboard.");
            } else {
              next_actions.push("Run market init to begin collecting job data.");
            }
            console.log(JSON.stringify(formatSuccess("auth.status", data, { warnings, next_actions }), null, 2));
            break;
          }
          case "import-clipboard": {
            const clearClipboard = parsed.flags["no-clear"] ? false : true;
            const res = importFromClipboard({ paths, clearClipboard });
            if (!res.ok) {
              console.log(JSON.stringify(formatError("CLIPBOARD_IMPORT_FAILED", res.error, {
                next_actions: ["Ensure you clicked Copy Cookie Header in the browser extension and try again."]
              }), null, 2));
              process.exitCode = 1;
            } else {
              console.log(JSON.stringify(formatSuccess("auth.import-clipboard", res, {
                next_actions: ["Run auth status or market init."]
              }), null, 2));
            }
            break;
          }
          case "import-header": {
            const raw = parsed.positional[0] || parsed.flags.header;
            if (!raw) {
              console.log(JSON.stringify(formatError("INVALID_ARGUMENT", "Missing cookie header string."), null, 2));
              process.exitCode = 1;
              break;
            }
            const res = importCookieHeader(raw, { paths, source: "manual_cli" });
            if (!res.ok) {
              console.log(JSON.stringify(formatError("AUTH_IMPORT_FAILED", res.error), null, 2));
              process.exitCode = 1;
            } else {
              console.log(JSON.stringify(formatSuccess("auth.import-header", res), null, 2));
            }
            break;
          }
          case "import-file": {
            const filePath = parsed.positional[0] || parsed.flags.path;
            if (!filePath) {
              console.log(JSON.stringify(formatError("INVALID_ARGUMENT", "Missing file path to import."), null, 2));
              process.exitCode = 1;
              break;
            }
            const res = importFromFile(filePath, { paths });
            if (!res.ok) {
              console.log(JSON.stringify(formatError("AUTH_IMPORT_FAILED", res.error), null, 2));
              process.exitCode = 1;
            } else {
              console.log(JSON.stringify(formatSuccess("auth.import-file", res), null, 2));
            }
            break;
          }
          case "auto":
          case "import-bridge": {
            const res = await importFromBridge({ paths, domain: parsed.flags.domain || "zhipin.com" });
            if (!res.ok) {
              console.log(JSON.stringify(formatError("BRIDGE_IMPORT_FAILED", res.error, {
                next_actions: ["Ensure Chrome is running with Leo extension connected, or use auth import-clipboard."]
              }), null, 2));
              process.exitCode = 1;
            } else {
              console.log(JSON.stringify(formatSuccess("auth.auto", res, {
                next_actions: ["Cookies automatically fetched from Chrome browser via Leo Lantern bridge!"]
              }), null, 2));
            }
            break;
          }
          default: {
            console.log(JSON.stringify(formatError("UNKNOWN_SUBCOMMAND", `Unknown auth subcommand: ${subcommand}`), null, 2));
            process.exitCode = 1;
          }
        }
        break;
      }
      case "market": {
        switch (subcommand || "status") {
          case "init":
          case "update": {
            let cookieHeader = loadRawCookieHeader({ paths });
            if (!cookieHeader) {
              // Attempt automatic pull from lantern bridge
              const autoRes = await importFromBridge({ paths });
              if (autoRes.ok) {
                cookieHeader = loadRawCookieHeader({ paths });
              }
            }
            if (!cookieHeader) {
              console.log(JSON.stringify(formatError("AUTH_REQUIRED", "BOSS Zhipin Cookie Header is missing and Lantern bridge is unreachable.", {
                next_actions: ["Copy Cookie Header from the browser extension, then run: auth import-clipboard"]
              }), null, 2));
              process.exitCode = 1;
              break;
            }

            const client = new BossClient({ cookieHeader });
            const target = parsed.flags.target ? parseInt(parsed.flags.target, 10) : 100;
            const city = parsed.flags.city || "北京";


            const runResult = await executeMarketRun({
              paths,
              client,
              runStore,
              jobStore,
              target,
              city,
            });

            console.log(JSON.stringify(formatSuccess(`market.${subcommand}`, runResult, {
              next_actions: ["Run market report to see capability breakdown or jobs list to review jobs."]
            }), null, 2));
            break;
          }
          case "status": {
            const latest = runStore.getLatestResumableRun();
            const facts = jobStore.loadJobFacts();
            console.log(JSON.stringify(formatSuccess("market.status", {
              latest_run: latest,
              total_collected_facts: facts.length,
            }), null, 2));
            break;
          }
          case "report": {
            const report = generateMarketReport({ paths, jobStore });
            console.log(JSON.stringify(formatSuccess("market.report", report), null, 2));
            break;
          }
          default: {
            console.log(JSON.stringify(formatError("UNKNOWN_SUBCOMMAND", `Unknown market subcommand: ${subcommand}`), null, 2));
            process.exitCode = 1;
          }
        }
        break;
      }
      case "jobs": {
        switch (subcommand || "list") {
          case "list": {
            const limit = parsed.flags.limit ? parseInt(parsed.flags.limit, 10) : 50;
            const facts = jobStore.loadJobFacts();
            const sliced = facts.slice(0, limit).map((f) => ({
              id: f.source_job_id,
              canonical_key: f.canonical_key,
              title: f.title,
              salary: f.salary?.raw,
              company: f.company?.name,
              district: f.location?.district,
              recruiter_active: f.recruiter?.activity_raw,
            }));
            console.log(JSON.stringify(formatSuccess("jobs.list", { total: facts.length, jobs: sliced }), null, 2));
            break;
          }
          case "show": {
            const id = parsed.flags.id || parsed.positional[0];
            if (!id) {
              console.log(JSON.stringify(formatError("INVALID_ARGUMENT", "Missing --id parameter."), null, 2));
              process.exitCode = 1;
              break;
            }
            const facts = jobStore.loadJobFacts((f) => f.source_job_id === id || f.canonical_key === id);
            if (facts.length === 0) {
              console.log(JSON.stringify(formatError("JOB_NOT_FOUND", `Job not found: ${id}`), null, 2));
              process.exitCode = 1;
              break;
            }
            console.log(JSON.stringify(formatSuccess("jobs.show", facts[0]), null, 2));
            break;
          }
          default: {
            console.log(JSON.stringify(formatError("UNKNOWN_SUBCOMMAND", `Unknown jobs subcommand: ${subcommand}`), null, 2));
            process.exitCode = 1;
          }
        }
        break;
      }
      case "profile": {
        switch (subcommand || "status") {
          case "init": {
            const overrides = {};
            if (parsed.flags.city) overrides.target_city = parsed.flags.city;
            if (parsed.flags.role) overrides.target_role = parsed.flags.role;
            if (parsed.flags["target-level"]) overrides.level = { target_benchmark: parsed.flags["target-level"] };
            if (parsed.flags.exp) overrides.experience_years = parseInt(parsed.flags.exp, 10);
            if (parsed.flags.comp) overrides.compensation = { target_band: parsed.flags.comp };

            const prof = initCareerProfile({ paths, overrides });
            console.log(JSON.stringify(formatSuccess("profile.init", prof, {
              next_actions: ["Profile initialized. Run gap analyze to evaluate capability gaps."]
            }), null, 2));
            break;
          }
          case "status": {
            const prof = loadCareerProfile({ paths });
            console.log(JSON.stringify(formatSuccess("profile.status", { profile: prof }), null, 2));
            break;
          }
          case "set-eval": {
            let assessments = {};
            if (parsed.flags.data) {
              try {
                assessments = JSON.parse(parsed.flags.data);
              } catch (e) {
                console.log(JSON.stringify(formatError("INVALID_JSON", "Failed to parse --data JSON."), null, 2));
                process.exitCode = 1;
                break;
              }
            } else if (parsed.flags.skill && parsed.flags.level) {
              assessments[parsed.flags.skill] = parsed.flags.level;
            }
            const current = loadCareerProfile({ paths });
            const merged = { ...(current.assessments || {}), ...assessments };
            const prof = updateCareerProfile({ assessments: merged }, { paths });
            console.log(JSON.stringify(formatSuccess("profile.set-eval", { profile: prof }, {
              next_actions: ["Assessments updated. Run gap analyze to generate report."]
            }), null, 2));
            break;
          }
          default: {
            console.log(JSON.stringify(formatError("UNKNOWN_SUBCOMMAND", `Unknown profile subcommand: ${subcommand}`), null, 2));
            process.exitCode = 1;
          }
        }
        break;
      }
      case "gap": {
        switch (subcommand || "analyze") {
          case "analyze": {
            const prof = loadCareerProfile({ paths });
            let inputAssessments = prof.assessments || {};
            if (parsed.flags.evals) {
              try {
                inputAssessments = { ...inputAssessments, ...JSON.parse(parsed.flags.evals) };
              } catch {}
            }

            const marketSummary = generateMarketReport({ paths, jobStore });
            const gapAnalysis = analyzeCapabilityGaps({
              userProfile: prof,
              userAssessments: inputAssessments,
              marketSummary,
            });

            const markdown = generateMarkdownGapReport({
              userProfile: prof,
              gapAnalysis,
              marketSummary,
            });

            const savedPath = saveMarkdownGapReport(markdown, { paths });

            console.log(JSON.stringify(formatSuccess("gap.analyze", {
              report_file: savedPath,
              summary: {
                total_valid_jobs: marketSummary.total_valid_jobs,
                top_blockers: gapAnalysis.top_blockers.map(b => b.skill),
                secondary_gaps_count: gapAnalysis.secondary_gaps.length,
                solid_baseline_count: gapAnalysis.solid_baseline.length,
              },
              markdown,
            }, {
              next_actions: [`Markdown report generated and saved at: ${savedPath}`]
            }), null, 2));
            break;
          }
          case "report": {
            const reportPath = path.join(paths.reports, "gap-analysis-report.md");
            if (!fs.existsSync(reportPath)) {
              console.log(JSON.stringify(formatError("REPORT_NOT_FOUND", "No gap analysis report found. Run gap analyze first."), null, 2));
              process.exitCode = 1;
              break;
            }
            const content = fs.readFileSync(reportPath, "utf8");
            console.log(JSON.stringify(formatSuccess("gap.report", {
              report_file: reportPath,
              markdown: content,
            }), null, 2));
            break;
          }
          default: {
            console.log(JSON.stringify(formatError("UNKNOWN_SUBCOMMAND", `Unknown gap subcommand: ${subcommand}`), null, 2));
            process.exitCode = 1;
          }
        }
        break;
      }
      case "help":
      case "--help":
      case "-h": {
        console.log(JSON.stringify({
          ok: true,
          command: "help",
          data: {
            commands: [
              "doctor",
              "auth [status|import-clipboard|import-header|import-file|verify]",
              "market [init|update|status|report]",
              "jobs [list|show]",
              "profile [init|status|set-eval]",
              "gap [analyze|report]"
            ]
          }
        }, null, 2));
        break;
      }
      default: {
        const res = formatError("COMMAND_NOT_FOUND", `Unknown command: ${command}`, {
          next_actions: ["Run doctor or help to view available commands."]
        });
        console.log(JSON.stringify(res, null, 2));
        process.exitCode = 1;
      }
    }
  } catch (err) {
    const res = formatError("INTERNAL_ERROR", err.message || String(err));
    console.log(JSON.stringify(res, null, 2));
    process.exitCode = 1;
  }
}

main();
