/**
 * Market index cache with offline fallback.
 */

import fs from "node:fs";

import { DreamSkinError } from "../domain/errors.mjs";
import { assertMarketIndex } from "./schema.mjs";
import { atomicWriteFile } from "../library/filesystem.mjs";

export function createMarketCache({ indexPath, client, clock = () => new Date().toISOString(), logger = console }) {
  let currentIndex = null;

  async function load({ forceRefresh = false } = {}) {
    if (!forceRefresh && currentIndex) {
      return { index: currentIndex, cached: false, warning: null };
    }

    try {
      const response = await client.fetchIndexBytes();
      const bytes = response.bytes;

      // Parse and validate before writing to cache
      const parsed = JSON.parse(bytes.toString("utf8"));
      const index = assertMarketIndex(parsed);

      // Write to cache atomically
      await atomicWriteFile(indexPath, JSON.stringify(index, null, 2));
      currentIndex = index;

      return { index, cached: false, warning: null };
    } catch (networkError) {
      // Try cache fallback
      try {
        const cached = await readValidated();
        currentIndex = cached;
        return {
          index: cached,
          cached: true,
          warning: {
            code: "market_cache_fallback",
            message: "\u5728\u7EBF\u4E3B\u9898\u5E02\u573A\u6682\u4E0D\u53EF\u7528\uFF0C\u5F53\u524D\u663E\u793A\u672C\u5730\u7F13\u5B58\u3002",
          },
        };
      } catch {
        // Both remote and cache failed
        throw new DreamSkinError(
          "market_unavailable",
          `\u4E3B\u9898\u5E02\u573A\u52A0\u8F7D\u5931\u8D25\uFF0C\u4E14\u6CA1\u6709\u53EF\u7528\u7F13\u5B58: ${networkError?.message || networkError}`,
        );
      }
    }
  }

  async function readValidated() {
    let bytes;
    try {
      bytes = await fs.promises.readFile(indexPath);
    } catch {
      throw new DreamSkinError("market_unavailable", "\u4E3B\u9898\u5E02\u573A\u7F13\u5B58\u4E0D\u5B58\u5728\u3002");
    }

    const parsed = JSON.parse(bytes.toString("utf8"));
    return assertMarketIndex(parsed);
  }

  function getCurrent() {
    return currentIndex;
  }

  return { load, readValidated, getCurrent };
}