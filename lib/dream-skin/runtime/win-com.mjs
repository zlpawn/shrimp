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
 * Uses PowerShell with Add-Type + IApplicationActivationManager so the
 * AppUserModelId receives the real command-line arguments (Start-Process
 * on shell:AppsFolder cannot reliably pass args to packaged apps).
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

  const execFile = execFileFn || (await import("node:child_process")).execFile;
  const safeId = appUserModelId.replace(/'/g, "''");
  const safeArgs = args.replace(/'/g, "''");

  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "$source = @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public class AppActivation {",
    "  [ComImport, Guid(\"2BA35A6E-6F1A-4F3A-84E5-BF4453C0E3D1\")]",
    "  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]",
    "  public interface IApplicationActivationManager {",
    "    [PreserveSig]",
    "    int ActivateApplication([In, MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [In, MarshalAs(UnmanagedType.LPWStr)] string arguments, [In] uint options, [Out] out uint processId);",
    "    [PreserveSig]",
    "    int ActivateForFile([In, MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [In] IntPtr itemArray, [In, MarshalAs(UnmanagedType.LPWStr)] string verb, [Out] out uint processId);",
    "    [PreserveSig]",
    "    int ActivateForProtocol([In, MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [In] IntPtr itemArray, [Out] out uint processId);",
    "  }",
    "  [ComImport, Guid(\"2B9B7D98-1AB6-4652-8D5F-6F5FE36F8DB9\")]",
    "  public class ApplicationActivationManager { }",
    "  public static uint Activate(string aumid, string arguments) {",
    "    var manager = (IApplicationActivationManager)new ApplicationActivationManager();",
    "    uint processId;",
    "    int hr = manager.ActivateApplication(aumid, arguments, 0, out processId);",
    "    Marshal.ThrowExceptionForHR(hr);",
    "    return processId;",
    "  }",
    "}",
    "'@",
    "Add-Type -TypeDefinition $source -Language CSharp",
    `$activatedPid = [AppActivation]::Activate('${safeId}', '${safeArgs}')`,
    "Write-Output $activatedPid",
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
