#!/usr/bin/env node
import { runRemoteCommand } from "../core/remote-exec.mjs";

/**
 * Generate remote shell script that recursively locates Git repositories
 * and safely pulls latest commits with --rebase --autostash.
 */
export function buildScanAndPullScript(remotePath) {
  return `
TARGET="${remotePath}"
if [ ! -d "$TARGET" ]; then
  echo "TARGET_DIR_NOT_FOUND:$TARGET"
  exit 1
fi

REPOS=""
if [ -d "$TARGET/.git" ]; then
  REPOS="$TARGET"
fi

SUB_REPOS=$(find "$TARGET" -maxdepth 3 -name ".git" -type d 2>/dev/null | grep -vE 'node_modules|\\.venv|vendor|\\.cache|dist|target|\\.idea|\\.vscode' | sed 's|/\\.git$||')

ALL_REPOS=$(printf "%s\\n%s\\n" "$REPOS" "$SUB_REPOS" | sed '/^$/d' | sort -u)

if [ -z "$ALL_REPOS" ]; then
  echo "NO_GIT_REPOS_FOUND:$TARGET"
  exit 0
fi

echo "$ALL_REPOS" | while IFS= read -r r; do
  [ -z "$r" ] && continue
  echo "===REPO_START:$r==="
  BRANCH=$(git -C "$r" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  echo "BRANCH:$BRANCH"
  DIRTY=$(git -C "$r" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "DIRTY:$DIRTY"
  PULL_OUT=$(git -C "$r" pull --rebase --autostash 2>&1)
  PULL_RC=$?
  echo "EXIT:$PULL_RC"
  echo "OUTPUT_BEGIN"
  echo "$PULL_OUT"
  echo "OUTPUT_END"
  echo "===REPO_END==="
done
`;
}

/**
 * Parse structured remote git stdout into clean JS object
 */
export function parseRemoteGitOutput(stdout, stderr = "") {
  if (stdout.includes("TARGET_DIR_NOT_FOUND:")) {
    const match = stdout.match(/TARGET_DIR_NOT_FOUND:(.+)/);
    const dir = match ? match[1].trim() : "";
    return {
      success: false,
      totalRepos: 0,
      updatedRepos: 0,
      failedRepos: 0,
      error: `Remote directory not found: ${dir}`,
      summary: `Directory does not exist: ${dir}`,
      repos: []
    };
  }

  if (stdout.includes("NO_GIT_REPOS_FOUND:")) {
    return {
      success: true,
      totalRepos: 0,
      updatedRepos: 0,
      failedRepos: 0,
      summary: "No Git repositories found in target directory.",
      repos: []
    };
  }

  const repos = [];
  const repoBlocks = stdout.split(/===REPO_START:/);

  for (const block of repoBlocks) {
    if (!block.trim()) continue;
    const endIdx = block.indexOf("===REPO_END===");
    const content = endIdx !== -1 ? block.slice(0, endIdx) : block;

    const lines = content.split(/\r?\n/);
    const repoPath = lines[0].replace(/===$/, "").trim();

    const branchMatch = content.match(/BRANCH:(.+)/);
    const dirtyMatch = content.match(/DIRTY:(\d+)/);
    const exitMatch = content.match(/EXIT:(\d+)/);

    let outputText = "";
    const outStart = content.indexOf("OUTPUT_BEGIN");
    const outEnd = content.indexOf("OUTPUT_END");
    if (outStart !== -1 && outEnd !== -1) {
      outputText = content.slice(outStart + "OUTPUT_BEGIN".length, outEnd).trim();
    }

    const branch = branchMatch ? branchMatch[1].trim() : "unknown";
    const dirty = dirtyMatch ? Number(dirtyMatch[1]) : 0;
    const exitCode = exitMatch ? Number(exitMatch[1]) : 0;
    const isSuccess = exitCode === 0;
    const isUpToDate = isSuccess && outputText.toLowerCase().includes("already up to date");

    repos.push({
      path: repoPath,
      branch,
      dirty,
      success: isSuccess,
      upToDate: isUpToDate,
      exitCode,
      output: outputText
    });
  }

  const totalRepos = repos.length;
  const updatedRepos = repos.filter(r => r.success && !r.upToDate).length;
  const failedRepos = repos.filter(r => !r.success).length;

  let summary = "";
  if (totalRepos === 0) {
    summary = "No Git repositories found.";
  } else if (failedRepos > 0) {
    summary = `Failed to pull in ${failedRepos}/${totalRepos} repos.`;
  } else if (updatedRepos > 0) {
    summary = `Updated ${updatedRepos}/${totalRepos} repos successfully.`;
  } else {
    summary = `All ${totalRepos} repo(s) are already up to date.`;
  }

  return {
    success: failedRepos === 0,
    totalRepos,
    updatedRepos,
    failedRepos,
    summary,
    repos
  };
}

/**
 * Perform remote Git discovery and auto-stash pull on a remote host
 * @param {string|object} hostOrAlias Host alias or config object
 * @param {string} remotePath Target directory path on remote host
 * @param {object} options Optional execution options
 */
export async function pullRemoteGit(hostOrAlias, remotePath, options = {}) {
  const script = buildScanAndPullScript(remotePath);
  const execOptions = { timeoutMs: 180000, ...options };
  try {
    const { stdout, stderr } = await runRemoteCommand(hostOrAlias, script, execOptions);
    const parsed = parseRemoteGitOutput(stdout, stderr);
    parsed.remotePath = remotePath;
    return parsed;
  } catch (err) {
    return {
      success: false,
      totalRepos: 0,
      updatedRepos: 0,
      failedRepos: 0,
      error: err.message,
      summary: `SSH execution error: ${err.message}`,
      repos: []
    };
  }
}
