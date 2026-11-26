import { openaiCompatibleStrategy } from "./openai-compatible.mjs";
import { codexSubscriptionStrategy } from "./codex-subscription.mjs";
import { antigravityStrategy } from "./antigravity.mjs";
import { grokSubscriptionStrategy } from "./grok-subscription.mjs";
import { huoshanArkStrategy, normalizeArkModelName } from "./huoshan-ark.mjs";
import { workbuddyStrategy } from "./workbuddy.mjs";
import { ofmStrategy } from "./ofm.mjs";
import { quickStrategy } from "./quick.mjs";

export function createDefaultStrategies(extraStrategies = []) {
  // Special strategies first, generic base_url fallback last.
  return [
    workbuddyStrategy,
    ofmStrategy,
    quickStrategy,
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
  ofmStrategy,
  quickStrategy,
  openaiCompatibleStrategy,
  codexSubscriptionStrategy,
  antigravityStrategy,
  grokSubscriptionStrategy,
  huoshanArkStrategy,
  normalizeArkModelName,
};

