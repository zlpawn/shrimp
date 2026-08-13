/**
 * Dream Skin application service: sole orchestration layer for HTTP routes.
 */

import { DreamSkinError } from "../domain/errors.mjs";
import { assertValidTheme } from "../domain/theme-schema.mjs";
import { inspectImage } from "../domain/image-format.mjs";
import { buildPreviewModel } from "../preview/model.mjs";

import { createThemeLibrary, BUILTIN_ID } from "../library/store.mjs";
import { createThemeImporter } from "../library/importer.mjs";
import { createMutationQueue } from "../library/mutation-queue.mjs";

import { createMarketClient, createNodeBinaryRequest } from "../market/client.mjs";
import { createMarketCache } from "../market/cache.mjs";
import { createInstallRecords } from "../market/install-records.mjs";
import { createMarketInstaller } from "../market/installer.mjs";

const DEFAULT_MARKET_INDEX_URL = "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/index.json";
const DEFAULT_MARKET_RAW_BASE_URL = "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlus-Themes/main/";

export function createDreamSkinService({
  paths,
  builtinThemePath,
  requestBinary,
  indexUrl = DEFAULT_MARKET_INDEX_URL,
  rawBaseUrl = DEFAULT_MARKET_RAW_BASE_URL,
  timeoutMs = 10000,
  clock = () => new Date().toISOString(),
  logger = console,
  packageProvider = null,
  cssCompiler = null,
  communityProvider = null,
  applier = null,
}) {
  const mutationQueue = createMutationQueue();

  const library = createThemeLibrary({ paths, builtinThemePath, mutationQueue, clock, logger });

  const marketClient = createMarketClient({
    requestBinary: requestBinary || createNodeBinaryRequest(),
    indexUrl,
    rawBaseUrl,
    timeoutMs,
  });

  const marketCache = createMarketCache({
    indexPath: paths.marketIndexPath,
    client: marketClient,
    clock,
    logger,
  });

  const installRecords = createInstallRecords({
    installedPath: paths.installedPath,
    clock,
  });

  const installer = createMarketInstaller({
    marketCache,
    marketClient,
    themeLibrary: library,
    installRecords,
    paths,
    logger,
  });

  const importer = createThemeImporter({
    library,
    canReplace: async (id) => {
      const record = await installRecords.get(id);
      // Can only replace locally-created themes (not market-installed)
      return !record;
    },
  });

  async function initialize() {
    return library.initialize();
  }

  function getCapabilities() {
    return {
      packageImport: false,
      customCss: false,
      communityPublishing: false,
      codexRuntime: Boolean(applier),
    };
  }

  async function listThemes() {
    return library.listThemes();
  }

  async function getTheme(id) {
    return library.getTheme(id);
  }

  async function getThemeImage(id) {
    const detail = await library.getTheme(id);
    if (!detail.imageBytes || !detail.imageFormat) {
      throw new DreamSkinError("theme_not_found", "\u4E3B\u9898\u6CA1\u6709\u80CC\u666F\u56FE\u7247\u3002");
    }
    return { bytes: detail.imageBytes, mime: detail.imageFormat.mime };
  }

  async function createTheme(input) {
    return library.createTheme(input);
  }

  async function updateTheme(id, input) {
    // Check if this is a market theme
    const record = await installRecords.get(id);
    if (record) {
      // Market theme: duplicate to local copy first
      const detail = await library.getTheme(id);
      const dup = await library.duplicateTheme(id, { name: `${detail.theme.name} (Local)` });
      // Now edit the duplicate
      return library.updateTheme(dup.id, input);
    }
    return library.updateTheme(id, input);
  }

  async function duplicateTheme(id, input) {
    return library.duplicateTheme(id, input);
  }

  async function selectTheme(id) {
    return library.selectTheme(id);
  }

  async function deleteTheme(id) {
    // If it's a market theme, also remove install record
    const record = await installRecords.get(id);
    if (record) {
      return library.deleteTheme(id, {
        onCommit: async () => {
          await installRecords.remove(id);
        },
      });
    }
    return library.deleteTheme(id);
  }

  async function importTheme({ theme, imageBytes, conflict, requestedId }) {
    // Reject unsupported features
    if (theme && (theme.css || theme.javascript || theme.html || theme.url)) {
      throw new DreamSkinError("unsupported_feature", "\u5F53\u524D\u7248\u672C\u4E0D\u652F\u6301\u8BE5\u4E3B\u9898\u80FD\u529B\u3002");
    }

    return importer.importTheme({ theme, imageBytes, conflict, requestedId });
  }

  async function loadMarket({ forceRefresh } = {}) {
    const result = await marketCache.load({ forceRefresh });
    const localThemes = await library.listThemes();
    const marketThemes = await installer.mergeMarketState(result.index, localThemes.themes);

    return {
      themes: marketThemes,
      updatedAt: result.index.updatedAt,
      cached: result.cached,
      warning: result.warning,
    };
  }

  async function installMarketTheme(id) {
    return installer.install(id);
  }

  async function updateMarketTheme(id) {
    return installer.update(id);
  }

  async function getMarketPreview(id) {
    return installer.getPreview(id);
  }

  async function applyTheme(id) {
    if (!applier) {
      throw new DreamSkinError("unsupported_feature", "Codex 运行时注入未启用。");
    }
    const detail = await library.getTheme(id);
    const themeJsonBytes = Buffer.from(JSON.stringify(detail.theme, null, 2), "utf8");
    return applier.applyTheme({
      themeJsonBytes,
      imageBytes: detail.imageBytes || undefined,
    });
  }

  return {
    initialize,
    getCapabilities,
    applyTheme,
    listThemes,
    getTheme,
    getThemeImage,
    createTheme,
    updateTheme,
    duplicateTheme,
    selectTheme,
    deleteTheme,
    importTheme,
    loadMarket,
    installMarketTheme,
    updateMarketTheme,
    getMarketPreview,
    get mutationQueue() { return mutationQueue; },
  };
}

export { DEFAULT_MARKET_INDEX_URL, DEFAULT_MARKET_RAW_BASE_URL };