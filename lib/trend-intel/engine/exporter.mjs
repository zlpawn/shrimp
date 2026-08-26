import fs from "node:fs";
import path from "node:path";

/**
 * Exports latest and archived brief markdown and events JSON files to data directory.
 * 
 * @param {string} dataDir 
 * @param {Object | string} brief 
 * @param {Array<Object>} [events] 
 * @returns {{ briefPath: string, jsonPath: string, archiveBriefPath: string, archiveJsonPath: string }}
 */
export function exportArtifactFiles(dataDir, brief, events = []) {
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("dataDir is required for artifact export");
  }

  const archiveDir = path.join(dataDir, "archive");
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const dateStr = (typeof brief === "object" && brief?.date)
    ? String(brief.date)
    : new Date().toISOString().slice(0, 10);

  const markdownContent = typeof brief === "string"
    ? brief
    : (brief?.markdown || "");

  const jsonContent = JSON.stringify(events, null, 2);

  const briefPath = path.join(dataDir, "latest_brief.md");
  const jsonPath = path.join(dataDir, "latest_events.json");
  const archiveBriefPath = path.join(archiveDir, `${dateStr}_brief.md`);
  const archiveJsonPath = path.join(archiveDir, `${dateStr}_events.json`);

  fs.writeFileSync(briefPath, markdownContent, "utf-8");
  fs.writeFileSync(jsonPath, jsonContent, "utf-8");
  fs.writeFileSync(archiveBriefPath, markdownContent, "utf-8");
  fs.writeFileSync(archiveJsonPath, jsonContent, "utf-8");

  return {
    briefPath,
    jsonPath,
    archiveBriefPath,
    archiveJsonPath
  };
}
