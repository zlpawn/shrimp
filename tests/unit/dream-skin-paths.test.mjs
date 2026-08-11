import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  PROJECT_ROOT,
  resolveProjectPath,
} from "../../lib/config/project-paths.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";

test("resolveProjectPath keeps absolute paths and resolves relative paths under the project", () => {
  assert.equal(resolveProjectPath("gateway.config.json"), path.join(PROJECT_ROOT, "gateway.config.json"));
  assert.equal(resolveProjectPath("/tmp/shrimp/gateway.config.json"), "/tmp/shrimp/gateway.config.json");
  assert.equal(resolveProjectPath(""), "");
});

test("dream-skin data follows the resolved gateway config directory", () => {
  const paths = resolveDreamSkinPaths({
    configFile: "config/gateway.config.json",
    projectRoot: "/workspace/shrimp",
  });

  assert.deepEqual(paths, {
    configPath: "/workspace/shrimp/config/gateway.config.json",
    configDir: "/workspace/shrimp/config",
    rootDir: "/workspace/shrimp/config/dream-skin",
    themesDir: "/workspace/shrimp/config/dream-skin/themes",
    cacheDir: "/workspace/shrimp/config/dream-skin/cache",
    statePath: "/workspace/shrimp/config/dream-skin/state.json",
  });
});

test("an npm data-dir config keeps dream-skin data beside that config", () => {
  const paths = resolveDreamSkinPaths({
    configFile: "/Users/example/.shrimp/gateway.config.json",
    projectRoot: "/unused/project",
  });

  assert.equal(paths.rootDir, "/Users/example/.shrimp/dream-skin");
  assert.equal(paths.themesDir, "/Users/example/.shrimp/dream-skin/themes");
});
