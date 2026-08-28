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
    case "lookup":
      return callAndFormat(client, "tdx_lookup_stock", { query: requireValue(args[1], "query") }, output);
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
  return `Usage: leo-tdx whoami | tools | schema <tool> | lookup <query> | quotes <code> [setcode] | kline <code> ... | token extract|status|set|clear`;
}

function parseJsonArgument(value, name) {
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError(`Invalid JSON arguments for ${name}.`, 2);
  }
}
