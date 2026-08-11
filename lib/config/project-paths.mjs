import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export function resolveProjectPath(targetPath, projectRoot = PROJECT_ROOT) {
  if (!targetPath) return "";
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.join(projectRoot, targetPath);
}
