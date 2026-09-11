export const POLICY_MODES = Object.freeze([
  "open",
  "confirm_dangerous",
  "confirm_all",
]);

const DANGEROUS_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bnpm\s+(i|install|ci)\b/i,
  /\bpnpm\s+(i|install)\b/i,
  /\byarn\s+add\b/i,
  /\bpip(?:3)?\s+install\b/i,
  /\brm\s+-rf\b/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\bdel\s+\/s\b/i,
  /\bDROP\s+(TABLE|DATABASE)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bformat\s+[A-Za-z]:/i,
];

export function normalizePolicyMode(value, fallback = "confirm_dangerous") {
  const mode = String(value || "").trim().toLowerCase();
  if (POLICY_MODES.includes(mode)) return mode;
  return fallback;
}

export function classifyDangerousAction(text = "") {
  const value = String(text || "");
  const matched = DANGEROUS_PATTERNS.filter((pattern) => pattern.test(value))
    .map((pattern) => String(pattern))
    .slice(0, 5);
  return {
    dangerous: matched.length > 0,
    reasons: matched,
  };
}

export function requiresConfirmation(policyMode, text = "") {
  const mode = normalizePolicyMode(policyMode);
  if (mode === "open") return { required: false, reason: "open", classification: classifyDangerousAction(text) };
  if (mode === "confirm_all") {
    return { required: true, reason: "confirm_all", classification: classifyDangerousAction(text) };
  }
  const classification = classifyDangerousAction(text);
  return {
    required: classification.dangerous,
    reason: classification.dangerous ? "dangerous" : "safe",
    classification,
  };
}
