import { createMcpClient } from "./mcp.mjs";
import {
  extractWorkBuddyToken,
  readToken,
  resolveSecretPaths,
  saveToken,
} from "./token.mjs";

const MARKET_SETCODES = { SH: "1", SZ: "0", BJ: "2", HK: "31" };
const DEFAULT_CLIENT_INFO = { name: "leo-tdx", version: "1.0.0" };
const OUTPUT_FORMATS = new Set(["json", "text", "raw"]);

export async function runCli(argv, {
  env = process.env,
  transport = null,
  tokenManager = { readToken, extractWorkBuddyToken, saveToken, resolveSecretPaths },
  readStdin = null,
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
      return callAndFormat(client, "tdx_kline", {
        ...security,
        period: flags.period || "day",
        count: positiveInt(flags.count, 30, "count"),
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
      return callAndFormat(client, "tdx_api_data", {
        entry: requireValue(args[1], "entry"),
        fixedTag: flags["fixed-tag"],
        mode: flags.mode,
        params: flags.params ? parseJsonArgument(flags.params, "params") : undefined,
      }, output);
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
  if (market && !MARKET_SETCODES[market]) throw new CliError(`Unknown market: ${market}. Use SH, SZ, BJ, or HK.`, 2);
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
const MARKET_LOOKUP_RANGES = { SH: "AG", SZ: "AG", BJ: "AG", HK: "HK-GP" };

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
    if (!MARKET_LOOKUP_RANGES[market]) throw new CliError(`Unknown market: ${market}. Use SH, SZ, BJ, or HK.`, 2);
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
    return { ok: true, status: "cleared" };
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
  throw new CliError("Usage: leo-tdx token extract | status | set [--stdin] | clear", 2);
}

async function processStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}

function usage() {
  return [
    "Usage: leo-tdx <command> [args] [--output json|text|raw]",
    "  whoami | tools [--name-only] | schema <tool>",
    "  lookup <query> [--range AG|HK-GP|HK-JJ|JJ|MG-GP|ZS|QH|QQ] [--market SH|SZ|BJ|HK]",
    "  quotes <code> [setcode] [--market ...] | kline <code> [--period ...] [--count N]",
    "  screener <query> | indicator <code> --indicators a,b",
    "  notice|report|news [symbol] [--name] [--from] [--to] [--keywords] | macro <pipe query>",
    "  futures <setDomain> [subCode] [--limit N] [--contracts-only] [--sort COL] [--order DIR]",
    "  futures-info <query...> | option <underlyMarket> <underlyCode> [--month YYMM] [--near PRICE] [--limit N]",
    "  deep <query...> --type A|HK|US|FUND|INDEX",
    "  tech-lookup <query...> [--limit N] | tech <code> --market ... --indicators ID,ID [--indicators-json JSON] [--count N]",
    "  listen <code> --market ... [--date YYYY-MM-DD]",
    "  api <entry> [--fixed-tag X] [--mode raw] [--params JSON] | call <tool> '<JSON>'",
    "  token extract|status|set --stdin|clear",
  ].join("\n");
}

function parseJsonArgument(value, name) {
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError(`Invalid JSON arguments for ${name}.`, 2);
  }
}
