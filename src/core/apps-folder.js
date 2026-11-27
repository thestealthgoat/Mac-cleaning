'use strict';

/**
 * What's really in the Applications folder.
 *
 * macOS's Storage settings counts everything inside /Applications as
 * "Applications" — including folders that aren't apps at all: sample-library
 * installers, vendor data folders (Waves keeps its instrument data there),
 * manuals and old versions. This module lists those items and recognises two
 * common space-wasters:
 *
 *   installer copies   a library's installer data kept after installing it,
 *                      duplicating files that already live elsewhere
 *   old versions       side-by-side versioned folders ("Plug-Ins V16" next to
 *                      "Plug-Ins V17")
 */
const fs = require('fs');
const path = require('path');
const { isWithin } = require('./paths');

/** Apps inside a folder, up to two levels down ("Blackmagic Cloud Store/Setup.app"). */
function appsInside(dir, depth = 2) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (e.name.endsWith('.app')) out.push(full);
    else if (depth > 1) out.push(...appsInside(full, depth - 1));
  }
  return out;
}

/**
 * Top-level items of the Applications folder with their sizes.
 * `sizes` is Map(path → { bytes }) from measureAll(['/Applications'], depth 1).
 * kind: 'app' | 'app-folder' (a folder holding apps) | 'content' (no apps, or
 * apps that are a tiny part of it) | 'file'.
 */
function listAppsFolder(sizes, root = '/Applications') {
  const items = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { total: 0, items };
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const full = path.join(root, e.name);
    const bytes = sizes.get(full)?.bytes ?? 0;
    if (e.name.endsWith('.app')) {
      items.push({ path: full, name: e.name.replace(/\.app$/, ''), bytes, kind: 'app', apps: [full] });
      continue;
    }
    if (!e.isDirectory()) {
      items.push({ path: full, name: e.name, bytes, kind: 'file', apps: [] });
      continue;
    }
    const apps = appsInside(full);
    const appBytes = apps.reduce((s, a) => s + (sizes.get(a)?.bytes ?? 0), 0);
    // A vendor folder of apps (e.g. "Microsoft Office") vs a data folder with a helper app in it.
    const kind = apps.length && (bytes < 1e9 || appBytes >= bytes * 0.5) ? 'app-folder' : 'content';
    items.push({ path: full, name: e.name, bytes, kind, apps });
  }
  const total = sizes.get(root)?.bytes ?? items.reduce((s, i) => s + i.bytes, 0);
  items.sort((a, b) => b.bytes - a.bytes);
  const notApps = items.filter((i) => i.kind === 'content' || i.kind === 'file').reduce((s, i) => s + i.bytes, 0);
  return { total, notApps, items };
}

/**
 * Side-by-side versioned folders inside `dir`: "Plug-Ins V16" + "Plug-Ins V17".
 * Returns { latest, older: [{ version, paths }] } or null.
 * `children` is a list of folder names (injected for tests).
 */
function versionedFolders(dir, children = null) {
  let names = children;
  if (!names) {
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return null;
    }
  }
  const byVersion = new Map();
  for (const n of names) {
    const m = n.match(/^(.+?)[\s_-]+v(\d{1,3})$/i);
    if (!m) continue;
    const v = Number(m[2]);
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(path.join(dir, n));
  }
  if (byVersion.size < 2) return null;
  const versions = [...byVersion.keys()].sort((a, b) => b - a);
  return { latest: versions[0], older: versions.slice(1).map((v) => ({ version: v, paths: byVersion.get(v) })) };
}

/**
 * Installer copies: candidate folders whose big files also exist elsewhere
 * (same file name and size). `files` are big files from the walk worker
 * ({ path, size, bytes }) covering both the candidates and the places
 * libraries get installed.
 */
function installerCopies(files, candidates, { minMatchBytes = 1e9 } = {}) {
  const byKey = new Map();
  for (const f of files) {
    const k = `${path.basename(f.path)}\0${f.size}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f);
  }
  const out = [];
  for (const c of candidates) {
    let matched = 0;
    let total = 0;
    const counterparts = [];
    for (const f of files) {
      if (!isWithin(f.path, c)) continue;
      total += f.bytes;
      const twin = (byKey.get(`${path.basename(f.path)}\0${f.size}`) || []).find((o) => !isWithin(o.path, c));
      if (twin) {
        matched += f.bytes;
        counterparts.push(twin.path);
      }
    }
    if (matched >= minMatchBytes) out.push({ path: c, matchedBytes: matched, scannedBytes: total, installedAt: commonDir(counterparts), files: counterparts.length });
  }
  return out.sort((a, b) => b.matchedBytes - a.matchedBytes);
}

function commonDir(paths) {
  if (!paths.length) return null;
  let parts = path.dirname(paths[0]).split(path.sep);
  for (const p of paths.slice(1)) {
    const q = path.dirname(p).split(path.sep);
    let i = 0;
    while (i < parts.length && i < q.length && parts[i] === q[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(path.sep) || '/';
}

module.exports = { listAppsFolder, appsInside, versionedFolders, installerCopies, commonDir };
