'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CATALOG, GROUPS } = require('./catalog');
const { expandGlob, expandHome, isWithin } = require('./paths');
const { allocated, PROTECTED_NAMES } = require('./size');
const { run, pool } = require('./exec');
const { installedApps, matchesInstalledApp } = require('./apps');

const CLEANABLE = new Set(['trash-contents', 'trash-paths', 'command', 'empty-trash']);

/**
 * Folders protected by macOS privacy controls (TCC / App Data protection).
 * Without Full Disk Access, reading inside the Containers folders makes macOS
 * show a permission prompt and the read *blocks* until it is answered — so we
 * do not touch them at all unless Full Disk Access has been granted.
 */
function protectedPrefixes(home) {
  return [
    'Library/Containers',
    'Library/Group Containers',
    'Library/Mail',
    'Library/Messages',
    'Library/Safari',
    'Library/Application Support/MobileSync',
    'Library/Application Support/com.apple.TCC',
  ].map((p) => path.join(home, p));
}

function needsFda(p, home) {
  return protectedPrefixes(home).some((pre) => isWithin(p, pre));
}

function resolveEntryPaths(entry, home, { fullDiskAccess = true } = {}) {
  const out = [];
  const skipped = [];
  for (const p of entry.paths) {
    if (p === '__TMPDIR_PARENT__') {
      // os.tmpdir() is /private/var/folders/xx/yyyy/T — its parent holds T, C (caches) and X.
      out.push(path.dirname(os.tmpdir().replace(/\/$/, '')));
      continue;
    }
    if (!fullDiskAccess && needsFda(expandHome(p, home), home)) {
      skipped.push(expandHome(p, home));
      continue;
    }
    out.push(...expandGlob(p, home));
  }
  return { paths: [...new Set(out)], skipped };
}

/**
 * Measure many paths with as few `du` passes as possible. Paths nested inside
 * another requested path are read from the parent's `du -d N` output instead of
 * walking the same tree twice. Returns Map(path → { bytes, partial, timedOut }).
 */
async function measureAll(paths, { depthFor = () => 0, timeoutMs = 5 * 60 * 1000, onDone, excludeNames = null } = {}) {
  const unique = [...new Set(paths)].sort();
  const tops = unique.filter((p) => !unique.some((q) => q !== p && isWithin(p, q)));
  const out = new Map();
  const limit = pool(4);
  await Promise.all(
    tops.map((top) =>
      limit(async () => {
        let st;
        try {
          st = fs.lstatSync(top);
        } catch {
          return;
        }
        if (!st.isDirectory()) {
          out.set(top, { bytes: allocated(st), partial: false });
          onDone?.(top);
          return;
        }
        const nested = unique.filter((p) => p !== top && isWithin(p, top));
        let depth = depthFor(top);
        for (const n of nested) depth = Math.max(depth, path.relative(top, n).split(path.sep).length);
        const args = ['-kx', '-d', String(depth)];
        if (excludeNames) for (const n of excludeNames) args.push('-I', n);
        const res = await run('/usr/bin/du', [...args, top], { timeout: timeoutMs });
        const timedOut = !!res.error && res.error.killed;
        const partial = timedOut || /Permission denied|Operation not permitted/.test(res.stderr);
        for (const line of res.stdout.split('\n')) {
          const tab = line.indexOf('\t');
          if (tab < 0) continue;
          out.set(line.slice(tab + 1), { bytes: parseInt(line.slice(0, tab), 10) * 1024, partial, timedOut });
        }
        if (!out.has(top)) out.set(top, { bytes: 0, partial: true, timedOut });
        // Nested *files* never show up in du's directory listing.
        for (const n of nested) {
          if (out.has(n)) continue;
          try {
            const s = fs.lstatSync(n);
            out.set(n, { bytes: s.isDirectory() ? 0 : allocated(s), partial: s.isDirectory() });
          } catch {
            /* vanished */
          }
        }
        onDone?.(top);
      }),
    ),
  );
  return out;
}

/**
 * Mark paths that live inside another measured path so totals never double
 * count (e.g. Homebrew's cache lives inside ~/Library/Caches).
 * Mutates path records, adding `nestedIn` (any item) and `nestedInCleanable`.
 */
function markNesting(items) {
  const all = [];
  for (const item of items) for (const rec of item.paths) all.push({ item, rec });
  all.forEach((a, ai) => {
    a.rec.nestedIn = null;
    a.rec.nestedInCleanable = null;
    all.forEach((b, bi) => {
      if (ai === bi) return;
      const strict = a.rec.path !== b.rec.path && isWithin(a.rec.path, b.rec.path);
      const dup = a.rec.path === b.rec.path && bi < ai; // identical path: later entry is the nested one
      if (!strict && !dup) return;
      if (!a.rec.nestedIn) a.rec.nestedIn = b.item.id;
      if (!a.rec.nestedInCleanable && b.item.cleanable) a.rec.nestedInCleanable = b.item.id;
    });
  });
  return items;
}

function summarize(items) {
  let explained = 0;
  let reclaimableSafe = 0;
  let reclaimableReview = 0;
  for (const item of items) {
    for (const rec of item.paths) {
      if (!rec.nestedIn) explained += rec.bytes;
      if (item.cleanable && !rec.nestedInCleanable) {
        if (item.safety === 'safe') reclaimableSafe += rec.bytes;
        else if (item.safety === 'review') reclaimableReview += rec.bytes;
      }
    }
  }
  return { explained, reclaimableSafe, reclaimableReview };
}

/** Children of `dir` taken from an existing du map (only direct children). */
function childrenFromMap(dir, sizes, limit = 12) {
  const kids = [];
  for (const [p, v] of sizes) {
    if (path.dirname(p) === dir) kids.push({ name: path.basename(p), path: p, bytes: v.bytes });
  }
  return kids.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

/** Measure every catalog entry. `onProgress({ done, total })` fires as top-level folders finish. */
async function scanHidden({ home = os.homedir(), onProgress, fullDiskAccess = true } = {}) {
  const entries = CATALOG.map((e) => ({ entry: e, ...resolveEntryPaths(e, home, { fullDiskAccess }) }));
  const allPaths = entries.flatMap((e) => e.paths);
  const breakdownPaths = new Set(entries.filter((e) => e.entry.breakdown).flatMap((e) => e.paths));
  const total = new Set(allPaths).size;
  let done = 0;
  const sizes = await measureAll(allPaths, {
    depthFor: (p) => (breakdownPaths.has(p) ? 1 : 0),
    excludeNames: fullDiskAccess ? null : PROTECTED_NAMES,
    onDone: () => onProgress?.({ done: ++done, total }),
  });

  let apps = null;
  if (entries.some((e) => e.entry.orphanCheck)) apps = await installedApps();

  const items = entries.map(({ entry, paths, skipped }) => {
    const recs = paths
      .filter((p) => sizes.has(p))
      .map((p) => ({ path: p, bytes: sizes.get(p).bytes, partial: !!sizes.get(p).partial, timedOut: !!sizes.get(p).timedOut }));
    const item = {
      id: entry.id,
      name: entry.name,
      group: entry.group,
      groupLabel: GROUPS[entry.group]?.label ?? entry.group,
      safety: entry.safety,
      action: entry.action,
      command: entry.command ?? null,
      minAgeDays: entry.minAgeDays ?? null,
      why: entry.why,
      cleanable: CLEANABLE.has(entry.action),
      needsFullDiskAccess: skipped.length > 0,
      paths: recs,
    };
    if (entry.breakdown) {
      item.breakdown = recs.flatMap((r) => childrenFromMap(r.path, sizes, 15)).sort((a, b) => b.bytes - a.bytes).slice(0, 15);
      if (entry.orphanCheck && apps) {
        for (const child of item.breakdown) child.orphan = child.bytes > 50e6 && !matchesInstalledApp(child.name, apps);
      }
    }
    return item;
  });

  markNesting(items);
  for (const item of items) {
    item.bytes = item.paths.reduce((s, r) => s + r.bytes, 0);
    item.uniqueBytes = item.paths.filter((r) => !r.nestedIn).reduce((s, r) => s + r.bytes, 0);
    item.partial = item.paths.some((r) => r.partial);
  }
  items.sort((a, b) => b.bytes - a.bytes);
  return { items, totals: summarize(items), scannedAt: Date.now(), fullDiskAccess };
}

module.exports = { scanHidden, resolveEntryPaths, measureAll, markNesting, summarize, needsFda, CLEANABLE };
