export function splitSqlScript(sql) {
  const text = String(sql || "");
  const statements = [];
  let current = "";
  let quote = null;
  let comment = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (comment === "line") {
      if (char === "\n") {
        comment = null;
        current += char;
      }
      continue;
    }
    if (comment === "block") {
      if (char === "*" && next === "/") {
        comment = null;
        i += 1;
      }
      continue;
    }

    if (!quote && char === "-" && next === "-") {
      comment = "line";
      i += 1;
      continue;
    }
    if (!quote && char === "/" && next === "*") {
      comment = "block";
      i += 1;
      continue;
    }
    if (!comment && (char === "'" || char === '"' || char === "\`")) {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      current += char;
      continue;
    }
    if (quote) {
      if (char === "\\" && i + 1 < text.length) {
        current += char + text[i + 1];
        i += 1;
        continue;
      }
      current += char;
      continue;
    }
    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }
    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
