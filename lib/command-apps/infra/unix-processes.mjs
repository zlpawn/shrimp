import { CommandAppsError } from "../domain/errors.mjs";

export async function terminateUnixProcessGroup(pid, {
  killProcessGroup = (value, signal) => process.kill(-value, signal),
} = {}) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CommandAppsError("invalid_request", "A valid process id is required");
  }
  try {
    killProcessGroup(value, "SIGTERM");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw new CommandAppsError("process_error", `Failed to stop process group ${value}`, {
      reason: error?.message,
    });
  }
}
