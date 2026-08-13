/**
 * Windows packaged app activation via PowerShell.
 *
 * Activates MS Store packaged Codex apps (OpenAI.Codex, OpenAI.ChatGPT-Desktop)
 * with --remote-debugging-port using shell:AppsFolder. The PowerShell
 * process runs fully hidden (no console window flashes to the user).
 *
 * Importing this module on non-Windows is safe; calling its functions
 * will throw.
 */

/**
 * Activate a packaged Windows app without showing a terminal window.
 *
 * @param {string} appUserModelId - e.g. "OpenAI.Codex_xxx!App"
 * @param {string} args - command-line args string
 * @param {object} deps - injected dependencies for testing
 * @returns {Promise<number>} process ID
 */
export async function activatePackagedApp(appUserModelId, args, { execFile: execFileFn } = {}) {
  if (process.platform !== "win32" && !execFileFn) {
    throw new Error("packaged app activation is only supported on Windows");
  }

  // execFile avoids invoking a shell, so no console window appears.
  const execFile = execFileFn || (await import("node:child_process")).execFile;
  const safeId = appUserModelId.replace(/'/g, "''");
  const safeArgs = args.replace(/'/g, "''");
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    `Start-Process -FilePath "shell:AppsFolder\\${safeId}" -ArgumentList '${safeArgs}' -PassThru | Select-Object -ExpandProperty Id`,
  ].join("\n");

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", psScript],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`PowerShell activation failed: ${(stderr || error.message).trim()}`));
          return;
        }
        const pid = parseInt(stdout.trim(), 10);
        if (!Number.isInteger(pid) || pid <= 0) {
          reject(new Error(`unexpected PowerShell output: ${stdout.trim()}`));
          return;
        }
        resolve(pid);
      },
    );
  });
}
