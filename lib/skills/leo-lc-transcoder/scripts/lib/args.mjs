// 极简参数解析：--key value 或 --flag（后面没有值时为 true），其余为位置参数
export function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      pos.push(arg);
      continue;
    }
    const next = argv[i + 1];
    opts[arg.slice(2)] = next !== undefined && !next.startsWith("--") ? argv[++i] : true;
  }
  return { pos, opts };
}
