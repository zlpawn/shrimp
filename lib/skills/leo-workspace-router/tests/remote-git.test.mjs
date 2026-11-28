import assert from "node:assert/strict";
import test from "node:test";
import { buildScanAndPullScript, parseRemoteGitOutput } from "../scripts/modules/remote-git.mjs";

test("buildScanAndPullScript constructs robust find and pull commands with ignores", () => {
  const script = buildScanAndPullScript("/workspace/my-project");
  assert.match(script, /TARGET="\/workspace\/my-project"/);
  assert.match(script, /node_modules/);
  assert.match(script, /core\.fsmonitor=false/);
  assert.match(script, /pull --rebase --autostash/);
});

test("parseRemoteGitOutput handles TARGET_DIR_NOT_FOUND", () => {
  const stdout = "TARGET_DIR_NOT_FOUND:/invalid/path\n";
  const res = parseRemoteGitOutput(stdout);
  assert.equal(res.success, false);
  assert.equal(res.totalRepos, 0);
  assert.match(res.summary, /does not exist/);
});

test("parseRemoteGitOutput handles NO_GIT_REPOS_FOUND", () => {
  const stdout = "NO_GIT_REPOS_FOUND:/workspace/empty\n";
  const res = parseRemoteGitOutput(stdout);
  assert.equal(res.success, true);
  assert.equal(res.totalRepos, 0);
  assert.match(res.summary, /No Git repositories found/);
});

test("parseRemoteGitOutput handles single up-to-date repo", () => {
  const stdout = `
===REPO_START:/workspace/app===
BRANCH:main
DIRTY:0
EXIT:0
OUTPUT_BEGIN
Already up to date.
OUTPUT_END
===REPO_END===
`;
  const res = parseRemoteGitOutput(stdout);
  assert.equal(res.success, true);
  assert.equal(res.totalRepos, 1);
  assert.equal(res.updatedRepos, 0);
  assert.equal(res.failedRepos, 0);
  assert.equal(res.repos[0].branch, "main");
  assert.equal(res.repos[0].upToDate, true);
  assert.match(res.summary, /already up to date/);
});

test("parseRemoteGitOutput handles multiple repos with updates", () => {
  const stdout = `
===REPO_START:/workspace/app===
BRANCH:main
DIRTY:0
EXIT:0
OUTPUT_BEGIN
Already up to date.
OUTPUT_END
===REPO_END===
===REPO_START:/workspace/packages/sub===
BRANCH:feature-x
DIRTY:2
EXIT:0
OUTPUT_BEGIN
Updating a1b2c3d..e4f5g6h
Fast-forward
 file.txt | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
OUTPUT_END
===REPO_END===
`;
  const res = parseRemoteGitOutput(stdout);
  assert.equal(res.success, true);
  assert.equal(res.totalRepos, 2);
  assert.equal(res.updatedRepos, 1);
  assert.equal(res.failedRepos, 0);
  assert.equal(res.repos[1].branch, "feature-x");
  assert.equal(res.repos[1].dirty, 2);
  assert.equal(res.repos[1].upToDate, false);
  assert.match(res.summary, /Updated 1\/2 repos/);
});

test("parseRemoteGitOutput handles failed repo pull", () => {
  const stdout = `
===REPO_START:/workspace/app===
BRANCH:main
DIRTY:0
EXIT:1
OUTPUT_BEGIN
fatal: unable to access 'https://github.com/repo': Could not resolve host
OUTPUT_END
===REPO_END===
`;
  const res = parseRemoteGitOutput(stdout);
  assert.equal(res.success, false);
  assert.equal(res.totalRepos, 1);
  assert.equal(res.failedRepos, 1);
  assert.match(res.summary, /Failed to pull in 1\/1 repos/);
});
