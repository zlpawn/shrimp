// Compatibility re-export. All build ownership lives in runtime/engine-assets.mjs.
export {
  ENGINE_DEFINITIONS,
  resolveEngine,
  loadEngineAssets,
  contentSignature,
  buildEngineScript,
  validateEngineAssets,
  assertScriptParses,
} from "../runtime/engine-assets.mjs";