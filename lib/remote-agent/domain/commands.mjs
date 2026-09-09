export function parseCommand(text) {
  const raw = String(text ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return { type: "help", raw };

  if (!trimmed.startsWith("/agent")) {
    return { type: "dispatch", raw: trimmed };
  }

  const body = trimmed.slice("/agent".length).trim();
  if (!body || body === "help") return { type: "help", raw: trimmed };

  const [head, ...rest] = body.split(/\s+/);
  const command = String(head || "").toLowerCase();
  const target = rest.join(" ").trim();

  if (command === "list") return { type: "list", raw: trimmed };
  if (command === "status") return { type: "status", raw: trimmed };
  if (command === "unbind") return { type: "unbind", raw: trimmed };
  if (command === "use") {
    return { type: "use", raw: trimmed, target };
  }
  return { type: "unknown", raw: trimmed, target: command };
}
