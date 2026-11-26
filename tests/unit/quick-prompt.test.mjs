import test from "node:test";
import assert from "node:assert/strict";
import {
  applyQuickPromptAdjustments,
  pruneQuickMessages,
} from "../../lib/quick/prompt.mjs";

test("applyQuickPromptAdjustments assigns conversation_id if provided", () => {
  const body = {
    messages: [
      { role: "user", content: "Write a hello world" },
    ],
  };
  applyQuickPromptAdjustments(body, "conv_123");
  assert.equal(body.conversation_id, "conv_123");
});

test("pruneQuickMessages prunes older non-system messages when exceeding maxChars", () => {
  const largeContent = "x".repeat(1000);
  const messages = [
    { role: "system", content: "system instruction" },
    { role: "user", content: `old user 1: ${largeContent}` },
    { role: "assistant", content: `old assistant 1: ${largeContent}` },
    { role: "user", content: `latest user: ${largeContent}` },
  ];
  const pruned = pruneQuickMessages(messages, 2500);
  assert.equal(pruned[0].role, "system");
  assert.equal(pruned[pruned.length - 1].content.startsWith("latest user"), true);
  assert.ok(pruned.length < messages.length);
});
