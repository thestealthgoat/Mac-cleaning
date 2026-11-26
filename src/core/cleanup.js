'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CATALOG } = require('./catalog');
const { checkTrashable } = require('./paths');
const { resolveEntryPaths } = require('./hidden');
const { allocated } = require('./size');

/**
 * Everything Silt removes goes to the Trash — never `rm`. The caller injects
 * `trashItem` (Electron's shell.trashItem in the app, a fake in tests), so
 * this module has no Electron dependency.
 */
async function trashPaths(paths, { trashItem, home = os.homedir(), sizeHint } = {}) {
  const results = [];
  for (const p of paths) {
    const check = checkTrashable(p, home);
    if (!check.ok) {
      results.push({ path: p, ok: false, reason: check.reason });
      continue;
    }
    let bytes = sizeHint?.get?.(p) ?? 0;
    try {
      await trashItem(p);
      results.push({ path: p, ok: true, bytes });
    } catch (err) {
      results.push({ path: p, ok: false, reason: err.message });
    }
  }
  return summarizeResults(results);
}

function summarizeResults(results) {
  return {
    results,
    moved: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    bytes: results.reduce((s, r) => s + (r.ok ? r.bytes || 0 : 0), 0),
  };
}

/** Rough size of a path for reporting (files exact, folders shallow-estimated by du later). */
function quickBytes(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() ? 0 : allocated(st);
  } catch {
    return 0;
  }
}

/**
 * Work out exactly which paths cleaning a catalog item would move to the Trash.
 * Paths are always re-resolved here from the catalog — the renderer never
 * gets to supply paths for catalog cleanups.
 */
function planCatalogClean(itemId, { home = os.homedir(), now = Date.now(), fullDiskAccess = true } = {}) {
  const entry = CATALOG.find((e) => e.id === itemId);
  if (!entry) throw new Error(`Unknown item: ${itemId}`);
  if (entry.action !== 'trash-contents' && entry.action !== 'trash-paths') {
    throw new Error(`${entry.name} cannot be cleaned directly from Silt.`);
  }
  const { paths: roots } = resolveEntryPaths(entry, home, { fullDiskAccess });
  const targets = [];
  if (entry.action === 'trash-paths') {
    targets.push(...roots);
  } else {
    const cutoff = entry.minAgeDays ? now - entry.minAgeDays * 86400000 : null;
    for (const root of roots) {
      let names = [];
      try {
        names = fs.readdirSync(root);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name === '.DS_Store') continue;
        const full = path.join(root, name);
        if (cutoff) {
          try {
            if (fs.lstatSync(full).mtimeMs > cutoff) continue;
          } catch {
            continue;
          }
        }
        targets.push(full);
      }
    }
  }
  return { entry, targets: targets.filter((t) => checkTrashable(t, home).ok) };
}

module.exports = { trashPaths, planCatalogClean, summarizeResults, quickBytes };
