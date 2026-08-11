import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { createMutationQueue } from "../../lib/dream-skin/library/mutation-queue.mjs";
import {
  ensureDreamSkinDirectories,
  commitThemeDirectory,
  removeThemeDirectory,
  recoverThemeTransactions,
  atomicWriteFile,
} from "../../lib/dream-skin/library/filesystem.mjs";
import { resolveDreamSkinPaths } from "../../lib/dream-skin/paths.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTempPaths() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dream-skin-test-"));
  return {
    paths: resolveDreamSkinPaths({
      configFile: path.join(tmpDir, "gateway.config.json"),
    }),
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

const FAKE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

// --- Mutation Queue ---

test("mutation queue serializes operations", async () => {
  const queue = createMutationQueue();
  const events = [];
  await Promise.all([
    queue.run(async () => { events.push("a:start"); await delay(10); events.push("a:end"); }),
    queue.run(async () => { events.push("b:start"); events.push("b:end"); }),
  ]);
  assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"]);
});

test("mutation queue continues after rejection", async () => {
  const queue = createMutationQueue();
  const events = [];
  await queue.run(async () => { throw new Error("boom"); }).catch(() => {});
  await queue.run(async () => { events.push("c"); });
  assert.deepEqual(events, ["c"]);
});

test("mutation queue idle resolves after all operations", async () => {
  const queue = createMutationQueue();
  let done = false;
  queue.run(async () => { await delay(5); done = true; });
  await queue.idle();
  assert.equal(done, true);
});

// --- Filesystem operations ---

test("ensureDreamSkinDirectories creates all dirs", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    assert.ok(fs.existsSync(paths.rootDir));
    assert.ok(fs.existsSync(paths.themesDir));
    assert.ok(fs.existsSync(paths.marketDir));
    assert.ok(fs.existsSync(paths.previewsDir));
    assert.ok(fs.existsSync(paths.stagingDir));
  } finally {
    cleanup();
  }
});

test("commitThemeDirectory creates new theme", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), "{}");
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), Buffer.from([0x89, 0x50]));
      },
    });
    const targetDir = path.join(paths.themesDir, "test-theme");
    assert.ok(fs.existsSync(path.join(targetDir, "theme.json")));
    assert.ok(fs.existsSync(path.join(targetDir, "image.png")));
  } finally {
    cleanup();
  }
});

test("commitThemeDirectory replaces existing with backup", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), '{"v":1}');
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "old");
      },
    });
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      replace: true,
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), '{"v":2}');
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "new");
      },
    });
    const targetDir = path.join(paths.themesDir, "test-theme");
    const content = fs.readFileSync(path.join(targetDir, "theme.json"), "utf8");
    assert.equal(content, '{"v":2}');
    const entries = fs.readdirSync(paths.themesDir);
    assert.ok(!entries.some((e) => e.includes(".backup-")));
  } finally {
    cleanup();
  }
});

test("commitThemeDirectory rolls back on onCommit failure", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), '{"v":1}');
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "old");
      },
    });
    await assert.rejects(
      commitThemeDirectory({
        paths,
        themeId: "test-theme",
        replace: true,
        writeStaging: async (stagingDir) => {
          await fs.promises.writeFile(path.join(stagingDir, "theme.json"), '{"v":2}');
          await fs.promises.writeFile(path.join(stagingDir, "image.png"), "new");
        },
        onCommit: async () => { throw new Error("commit failed"); },
      }),
      /commit failed/,
    );
    const targetDir = path.join(paths.themesDir, "test-theme");
    const content = fs.readFileSync(path.join(targetDir, "theme.json"), "utf8");
    assert.equal(content, '{"v":1}');
  } finally {
    cleanup();
  }
});

test("commitThemeDirectory rejects when theme exists and replace=false", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), "{}");
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "data");
      },
    });
    await assert.rejects(
      commitThemeDirectory({
        paths,
        themeId: "test-theme",
        replace: false,
        writeStaging: async (stagingDir) => {
          await fs.promises.writeFile(path.join(stagingDir, "theme.json"), '{"v":2}');
        },
      }),
      (err) => err instanceof DreamSkinError && err.code === "theme_already_exists",
    );
  } finally {
    cleanup();
  }
});

test("removeThemeDirectory removes theme", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), "{}");
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "data");
      },
    });
    await removeThemeDirectory({ paths, themeId: "test-theme" });
    assert.ok(!fs.existsSync(path.join(paths.themesDir, "test-theme")));
  } finally {
    cleanup();
  }
});

test("removeThemeDirectory rolls back on onCommit failure", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), "{}");
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "data");
      },
    });
    await assert.rejects(
      removeThemeDirectory({
        paths,
        themeId: "test-theme",
        onCommit: async () => { throw new Error("delete failed"); },
      }),
      /delete failed/,
    );
    assert.ok(fs.existsSync(path.join(paths.themesDir, "test-theme")));
  } finally {
    cleanup();
  }
});

test("recoverThemeTransactions restores backup when formal is missing", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), '{"v":1}');
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "data");
      },
    });
    const targetDir = path.join(paths.themesDir, "test-theme");
    const backupDir = path.join(paths.themesDir, `test-theme.backup-${FAKE_UUID}`);
    await fs.promises.rename(targetDir, backupDir);

    const result = await recoverThemeTransactions(paths, { logger: { warn() {} } });
    assert.ok(result.warnings.some((w) => w.code === "backup_restored"));
    assert.ok(fs.existsSync(targetDir));
    assert.ok(!fs.existsSync(backupDir));
  } finally {
    cleanup();
  }
});

test("recoverThemeTransactions removes backup when formal exists", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    await commitThemeDirectory({
      paths,
      themeId: "test-theme",
      writeStaging: async (stagingDir) => {
        await fs.promises.writeFile(path.join(stagingDir, "theme.json"), '{"v":1}');
        await fs.promises.writeFile(path.join(stagingDir, "image.png"), "data");
      },
    });
    const backupDir = path.join(paths.themesDir, `test-theme.backup-${FAKE_UUID}`);
    await fs.promises.mkdir(backupDir);
    await fs.promises.writeFile(path.join(backupDir, "theme.json"), '{"v":0}');
    await fs.promises.writeFile(path.join(backupDir, "image.png"), "old");

    const result = await recoverThemeTransactions(paths, { logger: { warn() {} } });
    assert.ok(result.warnings.some((w) => w.code === "backup_removed"));
    assert.ok(!fs.existsSync(backupDir));
  } finally {
    cleanup();
  }
});

test("recoverThemeTransactions cleans stale staging", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    const staleDir = path.join(paths.stagingDir, `old-theme-${FAKE_UUID}`);
    await fs.promises.mkdir(staleDir, { recursive: true });
    await fs.promises.writeFile(path.join(staleDir, "theme.json"), "{}");
    await fs.promises.writeFile(path.join(staleDir, "image.png"), "data");
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await fs.promises.utimes(staleDir, oldTime, oldTime);

    const result = await recoverThemeTransactions(paths, { logger: { warn() {} } });
    assert.ok(result.warnings.some((w) => w.code === "stale_staging_removed"));
    assert.ok(!fs.existsSync(staleDir));
  } finally {
    cleanup();
  }
});

test("atomicWriteFile writes data atomically", async () => {
  const { paths, cleanup } = makeTempPaths();
  try {
    await ensureDreamSkinDirectories(paths);
    const filePath = path.join(paths.rootDir, "test.json");
    await atomicWriteFile(filePath, '{"hello":"world"}');
    const content = fs.readFileSync(filePath, "utf8");
    assert.equal(content, '{"hello":"world"}');
  } finally {
    cleanup();
  }
});