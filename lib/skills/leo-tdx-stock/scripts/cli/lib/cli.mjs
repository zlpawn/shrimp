import { createMcpClient } from "./mcp.mjs";
import {
  getSkillsStatus,
  installSkills,
  removeSkills,
  updateSkills,
} from "./skills.mjs";
import {
  extractWorkBuddyToken,
  readToken,
  resolveSecretPaths,
  saveToken,
  syncAiDataToken,
} from "./token.mjs";

const MARKET_SETCODES = { SH: "1", SZ: "0", BJ: "2", HK: "31", US: "74" };
const DEFAULT_CLIENT_INFO = { name: "leo-tdx", version: "1.0.0" };
const OUTPUT_FORMATS = new Set(["json", "text", "raw"]);

export async function runCli(argv, {
  env = process.env,
  transport = null,
  tokenManager = { readToken, extractWorkBuddyToken, saveToken, resolveSecretPaths },
  readStdin = null,
  homeDir = undefined,
  fetchImpl = fetch,
} = {}) {
  const flags = parseFlags(argv);
  const args = flags.positionals;
  const output = flags.output || "json";
  const command = args[0];
  if (!OUTPUT_FORMATS.has(output)) {
    throw new CliError(`Unsupported output format: ${output}. Use json, text, or raw.`, 2);
  }

  if (command === "token") {
    const result = await runTokenCommand(args.slice(1), { env, tokenManager, readStdin, rawArgv: argv });
    return format(result, output);
  }
  if (command === "skills") {
    const result = await runSkillsCommand(args.slice(1), flags, { env, homeDir, fetchImpl });
    return output === "text" ? formatSkillsText(result) : format(result, output);
  }

  const token = readToken({ env });
  if (!token) {
    throw new CliError("TDX token is not configured. Run: leo-tdx token extract", 6);
  }
  const client = transport || createMcpClient({ token, url: env.TDX_MCP_URL, timeoutMs: flags.timeout });

  switch (command) {
    case "whoami":
      return format({ ok: true, result: await client.initialize() }, output);
    case "tools": {
      const tools = await client.listTools();
      if (flags["name-only"]) return format({ ok: true, result: { tools: tools.map((tool) => tool.name) } }, output);
      return format({ ok: true, result: { tools } }, output);
    }
    case "schema": {
      const tool = args[1];
      if (!tool) throw new CliError("Usage: leo-tdx schema <tool>", 2);
      const found = (await client.listTools()).find((item) => item.name === tool);
      if (!found) throw new CliError(`Unknown TDX tool: ${tool}`, 2);
      return format({ ok: true, result: found.inputSchema }, output);
    }
    case "lookup": {
      const range = resolveLookupRange(flags);
      return callAndFormat(client, "tdx_lookup_stock", {
        query: requireValue(args[1], "query"),
        ...(range ? { range } : {}),
      }, output);
    }
    case "quotes":
      return callAndFormat(client, "tdx_quotes", resolveSecurity(args.slice(1), flags), output);
    case "kline": {
      const security = resolveSecurity(args.slice(1), flags);
      const tqFlag = resolveKlineAdj(flags.adj);
      return callAndFormat(client, "tdx_kline", {
        ...security,
        period: resolveKlinePeriod(flags.period),
        wantNum: positiveInt(flags.count, 30, "count"),
        ...(tqFlag ? { tqFlag } : {}),
      }, output);
    }
    case "screener":
      return callAndFormat(client, "tdx_screener", {
        query: requireValue(args[1], "query"),
        limit: positiveInt(flags.limit, 100, "limit"),
      }, output);
    case "indicator": {
      const security = resolveSecurity(args.slice(1), flags);
      return callAndFormat(client, "tdx_indicator_select", {
        ...security,
        indicators: flags.indicators,
      }, output);
    }
    case "notice":
      return callAndFormat(client, "wenda_notice_query", structuredWendaArguments(args, flags), output);
    case "report":
      return callAndFormat(client, "wenda_report_query", structuredWendaArguments(args, flags), output);
    case "news":
      return callAndFormat(client, "wenda_news_query", structuredWendaArguments(args, flags), output);
    case "macro":
      return callAndFormat(client, "wenda_macro_query", {
        query: requireValue(args[1], "pipe query"),
      }, output);
    case "api":
      return callAndFormat(client, "tdx_api_data", buildApiArguments(args, flags), output);
    case "futures":
      return callAndFormat(client, "tdx_futures_quotes", {
        setDomain: requireValue(args[1], "setDomain"),
        subCode: args[2] === undefined ? "" : String(args[2]).toUpperCase(),
        wantNum: optionalPositiveInt(flags.limit, "limit", 500),
        contractsOnly: flags["contracts-only"] ? true : undefined,
        colType: optionalString(flags.sort),
        sortType: optionalString(flags.order),
      }, output);
    case "futures-info":
      return callAndFormat(client, "tdx_futures_deep_info", {
        query: requireValue(args.slice(1).join(" "), "query"),
      }, output);
    case "option":
      return callAndFormat(client, "tdx_option_t_quote", {
        underlyMarket: requireValue(args[1], "underlyMarket"),
        underlyCode: requireValue(args[2], "underlyCode"),
        month: optionalString(flags.month),
        wantNum: optionalPositiveInt(flags.limit, "limit", 500),
        underlyPrice: optionalString(flags.near),
      }, output);
    case "deep":
      return callAndFormat(client, "tdx_security_deep_info", {
        query: requireValue(args.slice(1).join(" "), "query"),
        entity_type: resolveEntityType(flags.type),
      }, output);
    case "tech-lookup": {
      const queries = args.slice(1);
      if (!queries.length) throw new CliError("Missing indicator query. Usage: leo-tdx tech-lookup <query...>", 2);
      return callAndFormat(client, "tdx_technical_indicator_lookup", {
        queries,
        limit: optionalPositiveInt(flags.limit, "limit", 20),
      }, output);
    }
    case "tech": {
      const security = resolveSecurity(args.slice(1), flags);
      return callAndFormat(client, "tdx_technical_indicator_query", {
        code: `${security.setcode}|${security.code}`,
        indicators: resolveTechIndicators(flags),
        limit: optionalPositiveInt(flags.count, "count", 5000),
      }, output);
    }
    case "listen": {
      const security = resolveSecurity(args.slice(1), flags);
      return callAndFormat(client, "tdx_ai_listening", {
        setcode_code: `${security.setcode}_${security.code}`,
        date: flags.date ? normalizeDate(flags.date) : localDate(),
      }, output);
    }
    case "call": {
      const tool = requireValue(args[1], "tool");
      return callAndFormat(
        client,
        tool,
        parseJsonArgument(requireValue(args[2], "arguments JSON"), "arguments"),
        output,
      );
    }
    default:
      throw new CliError(usage(), 2);
  }
}

export class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function parseFlags(argv) {
  const values = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positionals.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) values[key] = true;
    else { values[key] = next; i += 1; }
  }
  return { ...values, positionals };
}

function resolveSecurity(args, flags) {
  const code = requireValue(args[0], "code");
  const explicit = args[1];
  const market = flags.market?.toUpperCase();
  if (market && !MARKET_SETCODES[market]) throw new CliError(`Unknown market: ${market}. Use SH, SZ, BJ, HK, or US.`, 2);
  const mapped = MARKET_SETCODES[market];
  if (explicit && mapped && explicit !== mapped) {
    throw new CliError(`setcode ${explicit} conflicts with market ${market}.`, 2);
  }
  return { code, setcode: explicit || mapped || "1" };
}

async function callAndFormat(client, tool, arguments_, output) {
  if (output === "raw") return JSON.stringify(await client.callToolRaw(tool, arguments_));
  const text = await client.callTool(tool, arguments_);
  if (output === "text") return text;
  let result;
  try { result = JSON.parse(text); } catch { result = text; }
  return format({ ok: true, tool, result }, output);
}

function format(value, output) {
  if (output === "text") return typeof value === "string" ? value : JSON.stringify(value);
  if (output === "raw") return JSON.stringify(value);
  return JSON.stringify(value, null, 2);
}

function requireValue(value, name) {
  if (value === undefined || value === null || value === "") throw new CliError(`Missing ${name}.`, 2);
  return value;
}

const LOOKUP_RANGES = new Set(["AG", "HK-GP", "HK-JJ", "JJ", "MG-GP", "ZS", "QH", "QQ"]);
const MARKET_LOOKUP_RANGES = { SH: "AG", SZ: "AG", BJ: "AG", HK: "HK-GP", US: "MG-GP" };
const KLINE_PERIODS = {
  "0": "0", "5m": "0",
  "1": "1", "15m": "1",
  "2": "2", "30m": "2",
  "3": "3", "1h": "3", "60m": "3",
  "4": "4", day: "4", "1d": "4", d: "4",
  "5": "5", week: "5", "1w": "5", w: "5",
  "6": "6", month: "6", "1mo": "6", mo: "6",
  "7": "7", "1m": "7",
  "10": "10", quarter: "10", q: "10",
  "11": "11", year: "11", "1y": "11", y: "11",
  "12": "12", "5s": "12",
};
const KLINE_ADJ = {
  "0": "0", none: "0",
  "1": "1", front: "1", qfq: "1",
  "2": "2", back: "2", hfq: "2",
};

function resolveKlinePeriod(value) {
  if (value === undefined || value === true) return "4";
  const key = String(value).trim().toLowerCase();
  const mapped = KLINE_PERIODS[key];
  if (!mapped) {
    throw new CliError(`Unknown period: ${value}. Use 5s, 1m, 5m, 15m, 30m, 1h, day, week, month, quarter, year (or code 0..12).`, 2);
  }
  return mapped;
}

function resolveKlineAdj(value) {
  if (value === undefined || value === true) return undefined;
  const mapped = KLINE_ADJ[String(value).trim().toLowerCase()];
  if (!mapped) throw new CliError(`Unknown --adj: ${value}. Use none, front (qfq), or back (hfq).`, 2);
  return mapped;
}

function resolveLookupRange(flags) {
  if (flags.range !== undefined && flags.range !== true) {
    const range = String(flags.range).toUpperCase();
    if (!LOOKUP_RANGES.has(range)) {
      throw new CliError(`Unknown lookup range: ${range}. Use ${[...LOOKUP_RANGES].join(", ")}.`, 2);
    }
    return range;
  }
  if (flags.market !== undefined && flags.market !== true) {
    const market = String(flags.market).toUpperCase();
    if (!MARKET_LOOKUP_RANGES[market]) throw new CliError(`Unknown market: ${market}. Use SH, SZ, BJ, HK, or US.`, 2);
    return MARKET_LOOKUP_RANGES[market];
  }
  return undefined;
}

const ENTITY_TYPES = {
  A: "A股代码", "A股": "A股代码", "A股代码": "A股代码",
  HK: "港股代码", "港股": "港股代码", "港股代码": "港股代码",
  US: "美股代码", "美股": "美股代码", "美股代码": "美股代码",
  FUND: "基金代码", "基金": "基金代码", "基金代码": "基金代码",
  INDEX: "指数代码", "指数": "指数代码", "指数代码": "指数代码",
};

function resolveEntityType(value) {
  if (value === undefined || value === true) {
    throw new CliError("Missing --type. Use A, HK, US, FUND, or INDEX (or the lookup entity_type).", 2);
  }
  const resolved = ENTITY_TYPES[String(value).toUpperCase()] || ENTITY_TYPES[String(value)];
  if (!resolved) throw new CliError(`Unknown --type: ${value}. Use A, HK, US, FUND, or INDEX.`, 2);
  return resolved;
}

function resolveTechIndicators(flags) {
  if (flags["indicators-json"] !== undefined && flags["indicators-json"] !== true) {
    const parsed = parseJsonArgument(flags["indicators-json"], "indicators-json");
    if (!Array.isArray(parsed) || !parsed.length) throw new CliError("--indicators-json must be a non-empty array.", 2);
    return parsed;
  }
  if (flags.indicators === undefined || flags.indicators === true) {
    throw new CliError("Missing --indicators (comma-separated IDs) or --indicators-json.", 2);
  }
  const ids = String(flags.indicators).split(",").map((item) => item.trim()).filter(Boolean);
  if (!ids.length) throw new CliError("Missing --indicators.", 2);
  return ids.map((id) => ({ id }));
}

function optionalPositiveInt(value, name, max) {
  if (value === undefined || value === true) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new CliError(`${name} must be an integer from 1 to ${max}.`, 2);
  }
  return parsed;
}

function optionalString(value) {
  if (value === undefined || value === true) return undefined;
  return String(value);
}

function normalizeDate(value) {
  const text = String(value).trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  throw new CliError(`Invalid --date: ${text}. Use YYYY-MM-DD or YYYYMMDD.`, 2);
}

function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function positiveInt(value, fallback, name) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1000) throw new CliError(`${name} must be an integer from 1 to 1000.`, 2);
  return parsed;
}

function structuredWendaArguments(args, flags) {
  const arguments_ = {};
  const symbol = args[1];
  if (symbol !== undefined) arguments_.symbol = symbol;
  if (flags.name) arguments_.name = flags.name;
  if (flags.from) arguments_.bdate = flags.from;
  if (flags.to) arguments_.edate = flags.to;
  if (flags.keywords) arguments_.keywords = flags.keywords;
  if (flags.desc) arguments_.desc = flags.desc;
  if (flags.raw) arguments_.raw = flags.raw;
  if (!Object.keys(arguments_).length) throw new CliError("Provide a symbol, --name, --from, --to, --keywords, --desc, or --raw.", 2);
  return arguments_;
}

async function runTokenCommand(args, { env, tokenManager, readStdin, rawArgv = [] }) {
  const action = args[0];
  if (action === "extract") {
    const token = tokenManager.extractWorkBuddyToken({ env });
    if (!token) throw new CliError("Unable to extract TDX token. Open WorkBuddy, connect TDX, then rerun leo-tdx token extract.", 6);
    tokenManager.saveToken(token, { env });
    return { ok: true, status: "configured", source: "workbuddy" };
  }
  if (action === "status") {
    const configured = Boolean(env.TDX_TOKEN || tokenManager.readToken({ env }));
    return { configured, source: env.TDX_TOKEN ? "environment" : configured ? "file" : "missing" };
  }
  if (action === "clear") {
    const { token } = tokenManager.resolveSecretPaths({ env });
    await import("node:fs").then((fs) => fs.rmSync(token, { force: true }));
    (tokenManager.syncAiDataToken || syncAiDataToken)("", { env });
    return { ok: true, status: "cleared" };
  }
  if (action === "sync") {
    const token = tokenManager.readToken({ env });
    if (!token) throw new CliError("TDX token is not configured. Run: leo-tdx token extract", 6);
    const synced = (tokenManager.syncAiDataToken || syncAiDataToken)(token, { env });
    return { ok: true, status: synced.length ? "synced" : "no_aidata_ini", syncedCount: synced.length };
  }
  if (action === "set") {
    const tokenArgs = rawArgv;
    if (!tokenArgs.includes("--stdin")) {
      throw new CliError("Token input is only accepted through hidden stdin. Run: leo-tdx token set --stdin", 2);
    }
    const token = await (readStdin || processStdin)();
    tokenManager.saveToken(token, { env });
    return { ok: true, status: "configured", source: "input" };
  }
  throw new CliError("Usage: leo-tdx token extract | status | sync | set [--stdin] | clear", 2);
}

async function processStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}

function buildApiArguments(args, flags) {
  const entry = requireValue(args[1], "entry");
  let base = {};
  let rawParams;
  if (flags.params !== undefined && flags.params !== true) {
    const parsed = parseJsonArgument(flags.params, "params");
    if (Array.isArray(parsed)) rawParams = parsed;
    else if (parsed && typeof parsed === "object") base = { ...parsed };
    else throw new CliError("--params must be a JSON object or array.", 2);
  }
  const flagMap = {
    code: optionalString(flags.code),
    fixedTag: optionalString(flags["fixed-tag"]),
    mode: optionalString(flags.mode),
    branch: optionalString(flags.branch),
    extra: optionalString(flags.extra),
    extraOne: optionalString(flags["extra-one"]),
    extraTwo: optionalString(flags["extra-two"]),
    extraThree: optionalString(flags["extra-three"]),
    beginDate: optionalString(flags.from || flags["begin-date"]),
    endDate: optionalString(flags.to || flags["end-date"]),
    date: optionalString(flags.date),
    period: optionalString(flags.period),
    reportDate: optionalString(flags["report-date"]),
    pageNo: optionalString(flags.page),
    pageSize: optionalString(flags["page-size"] || flags.limit),
    queryKey: optionalString(flags["query-key"]),
    queryType: optionalString(flags["query-type"]),
    industryCode: optionalString(flags["industry-code"]),
    sortType: optionalString(flags.sort),
    title: optionalString(flags.title),
    stockCode: optionalString(flags["stock-code"]),
  };
  const merged = { entry, ...base };
  for (const [k, v] of Object.entries(flagMap)) {
    if (v !== undefined) merged[k] = v;
  }
  if (rawParams !== undefined) merged.params = rawParams;
  return merged;
}

async function runSkillsCommand(args, flags, { env, homeDir, fetchImpl }) {
  const action = args[0];
  const ids = args.slice(1);
  const centralDir = optionalString(flags.dir) || null;
  const linkDir = optionalString(flags["link-dir"]) || null;
  const link = !flags["no-link"];
  const force = Boolean(flags.force);

  try {
    if (action === "list" || action === "status") {
      const remote = action === "status" && Boolean(flags.remote);
      const result = await getSkillsStatus({ ids, remote, env, homeDir, centralDir, linkDir, fetchImpl });
      return { ok: true, action, ...result };
    }
    if (action === "install") {
      const result = await installSkills({
        ids,
        research: Boolean(flags.research),
        quant: Boolean(flags.quant),
        all: Boolean(flags.all),
        force,
        link,
        env,
        homeDir,
        centralDir,
        linkDir,
        fetchImpl,
      });
      return { ok: true, action, ...result };
    }
    if (action === "update") {
      const result = await updateSkills({
        ids,
        all: Boolean(flags.all),
        force,
        link,
        env,
        homeDir,
        centralDir,
        linkDir,
        fetchImpl,
      });
      return { ok: true, action, ...result };
    }
    if (action === "remove") {
      const result = removeSkills({ ids, force, env, homeDir, centralDir, linkDir });
      return { ok: true, action, ...result };
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    const message = error?.message || "SkillHub operation failed.";
    const code = /Unknown SkillHub skill|Specify skill ID/i.test(message) ? 2 : 5;
    throw new CliError(message, code);
  }
  throw new CliError("Usage: leo-tdx skills list|status [--remote]|install [<id...>] [--research|--quant|--all] [--force] [--no-link]|update [<id...>] [--all] [--force]|remove <id...>", 2);
}

function formatSkillsText(payload) {
  if (payload.skills) {
    const lines = [`Central: ${payload.roots.central}`, `Client:  ${payload.roots.antigravity}`];
    for (const item of payload.skills) {
      const state = item.installed ? `installed(${item.localVersion || "unknown"}, link:${item.linkStatus})` : "not-installed";
      const remote = item.remoteVersion ? ` -> remote(${item.remoteVersion}${item.updateAvailable ? ", update!" : ""})` : "";
      lines.push(`- ${item.id} [${item.group}] ${item.name}: ${state}${remote}`);
    }
    return lines.join("\n");
  }
  if (payload.results) {
    const lines = [`Central: ${payload.roots.central}`, `Client:  ${payload.roots.antigravity}`];
    for (const r of payload.results) {
      lines.push(`- ${r.id}: ${r.action}${r.version ? ` (${r.version})` : ""}${r.linkStatus ? ` [link:${r.linkStatus}]` : ""}`);
    }
    if (payload.message) lines.push(payload.message);
    return lines.join("\n");
  }
  return JSON.stringify(payload, null, 2);
}

function usage() {
  return [
    "Usage: leo-tdx <command> [args] [--output json|text|raw]",
    "  whoami | tools [--name-only] | schema <tool>",
    "  lookup <query> [--range AG|HK-GP|HK-JJ|JJ|MG-GP|ZS|QH|QQ] [--market SH|SZ|BJ|HK|US]",
    "  quotes <code> [setcode] [--market SH|SZ|BJ|HK|US] | kline <code> [--period day|week|month|1m|5m|15m|30m|1h] [--count N] [--adj none|front|back]",
    "  screener <query> | indicator <code> --indicators a,b",
    "  notice|report|news [symbol] [--name] [--from] [--to] [--keywords] | macro <pipe query>",
    "  futures <setDomain> [subCode] [--limit N] [--contracts-only] [--sort COL] [--order DIR]",
    "  futures-info <query...> | option <underlyMarket> <underlyCode> [--month YYMM] [--near PRICE] [--limit N]",
    "  deep <query...> --type A|HK|US|FUND|INDEX",
    "  tech-lookup <query...> [--limit N] | tech <code> --market ... --indicators ID,ID [--indicators-json JSON] [--count N]",
    "  listen <code> --market ... [--date YYYY-MM-DD]",
    "  api <entry> [--code C] [--fixed-tag X] [--branch B] [--extra-one X] [--extra-two Y] [--params JSON] | call <tool> '<JSON>'",
    "  skills list | status [--remote] | install [<id...>] [--research|--quant|--all] [--force] [--no-link] | update [<id...>] [--all] [--force] | remove <id...>",
    "  token extract|status|sync|set --stdin|clear",
  ].join("\n");
}

function parseJsonArgument(value, name) {
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError(`Invalid JSON arguments for ${name}.`, 2);
  }
}
