import { openaiCompatibleStrategy } from "./openai-compatible.mjs";
import { codexSubscriptionStrategy } from "./codex-subscription.mjs";
import { antigravityStrategy } from "./antigravity.mjs";
import { grokSubscriptionStrategy } from "./grok-subscription.mjs";
import { huoshanArkStrategy, normalizeArkModelName } from "./huoshan-ark.mjs";
import { workbuddyStrategy } from "./workbuddy.mjs";

export function createDefaultStrategies(extraStrategies = []) {
  // Special strategies first, generic base_url fallback last.
  return [
    workbuddyStrategy,
    codexSubscriptionStrategy,
    antigravityStrategy,
    grokSubscriptionStrategy,
    huoshanArkStrategy,
    ...extraStrategies,
    openaiCompatibleStrategy,
  ];
}

export {
  workbuddyStrategy,
  openaiCompatibleStrategy,
  codexSubscriptionStrategy,
  antigravityStrategy,
  grokSubscriptionStrategy,
  huoshanArkStrategy,
  normalizeArkModelName,
};

