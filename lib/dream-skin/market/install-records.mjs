/**
 * Market install records: tracks which themes are installed and from what version.
 */

import fs from "node:fs";

import { DreamSkinError } from "../domain/errors.mjs";
import { atomicWriteFile } from "../library/filesystem.mjs";

export function createInstallRecords({ installedPath, clock = () => new Date().toISOString() }) {
  async function load() {
    let raw;
    try {
      raw = await fs.promises.readFile(installedPath, "utf8");
    } catch {
      return { schemaVersion: 1, themes: {} };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { schemaVersion: 1, themes: {} };
    }

    if (parsed.schemaVersion !== 1) {
      return { schemaVersion: 1, themes: {} };
    }

    return parsed;
  }

  async function get(id) {
    const records = await load();
    return records.themes[id] || null;
  }

  async function set(id, { version, source = "market" }) {
    const records = await load();
    const now = clock();
    const existing = records.themes[id];

    const record = {
      version,
      source,
      installedAt: existing ? existing.installedAt : now,
      updatedAt: now,
    };

    records.themes[id] = record;
    await atomicWriteFile(installedPath, JSON.stringify(records, null, 2));
    return record;
  }

  async function remove(id) {
    const records = await load();
    if (!records.themes[id]) return;
    delete records.themes[id];
    await atomicWriteFile(installedPath, JSON.stringify(records, null, 2));
  }

  async function snapshot() {
    return load();
  }

  async function restore(snapshot) {
    await atomicWriteFile(installedPath, JSON.stringify(snapshot, null, 2));
  }

  return { load, get, set, remove, snapshot, restore };
}