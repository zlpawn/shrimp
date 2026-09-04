export function codexhostPublicStatus({ executable, installation, descriptor, controlReady, gateway, config, launching = false, error = null }) {
  const installed = Boolean(executable?.entrypointPath && executable?.launcherPath);
  const desktopPids = installation?.desktopProcessIds || [];
  const managed = Boolean(descriptor && controlReady);
  const conflict = desktopPids.length > 0 && !managed;
  const processStatus = error
    ? "error"
    : managed
      ? "running"
      : conflict
        ? "conflict"
        : launching
          ? "launching"
          : "stopped";
  const gatewayHealthy = Boolean(gateway?.ok && gateway?.service === "shrimp");
  return {
    runtime: {
      id: "codexhost",
      displayName: "CodexHost",
      kind: "managedRuntime",
      installed,
      version: executable?.version || null,
      executablePath: executable?.executablePath || "",
      packageName: "@codexhost/cli",
    },
    process: {
      status: processStatus,
      managed,
      launcherPid: managed ? descriptor.launcher_pid : null,
      desktopPids,
    },
    gateway: {
      healthy: gatewayHealthy,
      port: gateway?.port || null,
      models: Array.isArray(gateway?.models) ? gateway.models.length : 0,
    },
    codexConfig: config,
    desktop: {
      executablePath: installation?.desktopExecutable || "",
      launcherPath: installation?.desktopLauncher || "",
      version: installation?.version || null,
      build: installation?.build || null,
    },
    actions: {
      canStart: installed && gatewayHealthy && Boolean(config?.healthy) && !conflict && !managed && !launching,
      canStop: managed,
      canOpenOfficial: Boolean(installation?.desktopLauncher || installation?.desktopExecutable) && !managed && desktopPids.length === 0,
      stopRequiresConfirmation: managed,
    },
    error: error ? (error.message || String(error)) : null,
  };
}
