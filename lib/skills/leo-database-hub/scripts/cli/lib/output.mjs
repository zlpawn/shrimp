const FORMATTERS = new Map([
  ["json", formatJson],
  ["table", formatTable],
]);

export function formatOutput(value, format = "json") {
  const formatter = FORMATTERS.get(format);
  if (!formatter) throw new Error(`Unsupported output format: ${format}. Supported: json, table.`);
  return formatter(value);
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function formatTable(value) {
  const rows = Array.isArray(value) ? value
    : Array.isArray(value?.rows) ? value.rows
    : Array.isArray(value?.connections) ? value.connections
    : Array.isArray(value?.adapters) ? value.adapters
    : Array.isArray(value?.tables) ? value.tables
    : null;
  if (!rows?.length) return formatJson(value);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const rendered = rows.map((row) => columns.map((column) => stringifyCell(row[column])));
  const widths = columns.map((column, index) => Math.max(column.length, ...rendered.map((row) => row[index].length)));
  const header = columns.map((column, index) => column.padEnd(widths[index])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rendered.map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  "));
  return [header, separator, ...body].join("\n");
}

function stringifyCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
