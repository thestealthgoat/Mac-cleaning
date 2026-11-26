'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

function expandHome(p, home = HOME) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

function hasGlob(segment) {
  return /[*?]/.test(segment);
}

function segmentToRegExp(segment) {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Expand a path that may contain `*` / `?` wildcards in any segment
 * (e.g. "~/Library/Application Support/Slack/Cache" or "~/Downloads/*.dmg").
 * Returns only paths that exist. Never follows symlinks while matching.
 */
function expandGlob(pattern, home = HOME) {
  const abs = expandHome(pattern, home);
  const parts = abs.split(path.sep).filter(Boolean);
  let current = [path.sep];
  for (const part of parts) {
    const next = [];
    for (const base of current) {
      if (!hasGlob(part)) {
        const candidate = path.join(base, part);
        if (exists(candidate)) next.push(candidate);
        continue;
      }
      const re = segmentToRegExp(part);
      let entries = [];
      try {
        entries = fs.readdirSync(base);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (re.test(name)) next.push(path.join(base, name));
      }
    }
    current = next;
    if (current.length === 0) break;
  }
  return current;
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** True if `child` is `parent` or lives somewhere inside it. */
function isWithin(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Paths Silt will never move to the Trash, no matter what the UI asks for.
// Children of some of these (e.g. items inside ~/Library/Caches) are allowed.
function protectedRoots(home = HOME) {
  return [
    '/',
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/var',
    '/private',
    '/private/var',
    '/Library',
    '/Applications',
    '/Users',
    '/Volumes',
    '/opt',
    home,
    path.join(home, 'Library'),
    path.join(home, 'Library', 'Caches'),
    path.join(home, 'Library', 'Application Support'),
    path.join(home, 'Library', 'Containers'),
    path.join(home, 'Library', 'Group Containers'),
    path.join(home, 'Library', 'Preferences'),
    path.join(home, 'Library', 'Keychains'),
    path.join(home, 'Library', 'Mobile Documents'),
    path.join(home, 'Library', 'CloudStorage'),
    path.join(home, 'Library', 'Logs'),
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'Pictures'),
    path.join(home, 'Movies'),
    path.join(home, 'Music'),
    path.join(home, '.Trash'),
  ];
}

// Subtrees that must never be touched at all (not even their children).
function forbiddenTrees(home = HOME) {
  return [
    '/System',
    '/usr',
    '/bin',
    '/sbin',
    '/private/etc',
    '/private/var/db',
    '/private/var/vm',
    path.join(home, 'Library', 'Keychains'),
    path.join(home, 'Library', 'Mobile Documents'),
    path.join(home, 'Library', 'CloudStorage'),
    path.join(home, 'Library', 'Mail'),
    path.join(home, 'Library', 'Messages'),
    path.join(home, 'Library', 'Preferences'),
  ];
}

// Outside the home folder, only these locations may be cleaned.
const OUTSIDE_HOME_ALLOWED = ['/Applications', '/Library/Caches', '/Library/Logs', '/Users/Shared'];

/**
 * Decide whether `target` may be moved to the Trash. Returns { ok, reason }.
 * This is the single choke point every cleanup action goes through.
 */
function checkTrashable(target, home = HOME) {
  if (typeof target !== 'string' || !path.isAbsolute(target)) {
    return { ok: false, reason: 'Path must be absolute.' };
  }
  const p = path.resolve(target);
  if (p !== target.replace(/(.)\/+$/, '$1')) {
    return { ok: false, reason: 'Path must be normalized (no "..").' };
  }
  if (protectedRoots(home).includes(p)) {
    return { ok: false, reason: 'This folder is protected; only items inside it can be removed.' };
  }
  for (const tree of forbiddenTrees(home)) {
    if (isWithin(p, tree)) return { ok: false, reason: `Items inside ${tree} are never touched by Silt.` };
  }
  const inHome = isWithin(p, home);
  const allowedOutside = OUTSIDE_HOME_ALLOWED.some((root) => isWithin(p, root) && p !== root);
  if (!inHome && !allowedOutside) {
    return { ok: false, reason: 'Only items in your home folder, /Applications or shared caches can be removed.' };
  }
  if (p.startsWith('/Applications/') && path.dirname(p) !== '/Applications') {
    return { ok: false, reason: 'Only whole apps can be removed from /Applications.' };
  }
  if (!exists(p)) return { ok: false, reason: 'Item no longer exists.' };
  return { ok: true };
}

module.exports = {
  HOME,
  expandHome,
  expandGlob,
  segmentToRegExp,
  exists,
  isWithin,
  checkTrashable,
  protectedRoots,
  forbiddenTrees,
};
