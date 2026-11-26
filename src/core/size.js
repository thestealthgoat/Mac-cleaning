'use strict';

const fs = require('fs');
const path = require('path');
const { run, pool } = require('./exec');

const limit = pool(4);

// Folder names `du` skips when Silt lacks Full Disk Access. Reading inside them
// triggers a blocking macOS privacy prompt (App Data protection).
const PROTECTED_NAMES = ['Containers', 'Group Containers'];

const PACKAGE_RE = /\.(app|photoslibrary|fcpbundle|imovielibrary|logicx|band|bundle|framework|xcarchive|musiclibrary|tvlibrary|sparsebundle|vmwarevm|pvm|utm|plugin|component|vst3)$/i;

function allocated(st) {
  // st.blocks is in 512-byte units; fall back to logical size if unavailable.
  return typeof st.blocks === 'number' && st.blocks > 0 ? st.blocks * 512 : st.size;
}

/**
 * Allocated size on disk of a file or folder, in bytes, using the system `du`
 * (fast C traversal, counts hard links once, stays on one filesystem so the
 * firmlinked Data volume is never counted twice). Unreadable sub-folders are
 * skipped and reported via `partial: true`.
 */
async function sizeOf(target, { fullDiskAccess = true, timeoutMs = 20 * 60 * 1000 } = {}) {
  let st;
  try {
    st = fs.lstatSync(target);
  } catch {
    return { path: target, bytes: 0, exists: false, partial: false };
  }
  if (!st.isDirectory()) {
    return { path: target, bytes: allocated(st), exists: true, partial: false };
  }
  const args = ['-skx'];
  if (!fullDiskAccess) for (const n of PROTECTED_NAMES) args.push('-I', n);
  args.push(target);
  const res = await limit(() => run('/usr/bin/du', args, { timeout: timeoutMs }));
  const line = res.stdout.trim().split('\n').pop() || '';
  const kb = parseInt(line.split('\t')[0], 10);
  return {
    path: target,
    bytes: Number.isFinite(kb) ? kb * 1024 : 0,
    exists: true,
    partial: res.code !== 0 || /Permission denied|Operation not permitted/.test(res.stderr),
    timedOut: !!res.error?.killed,
  };
}

/** Fast listing of a folder's direct children. Files get their size; folders are measured separately. */
function listDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return { dir, children: [], error: err.code === 'EPERM' || err.code === 'EACCES' ? 'permission' : err.message };
  }
  const children = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    const isDir = st.isDirectory();
    children.push({
      name: e.name,
      path: full,
      isDir,
      isPackage: isDir && PACKAGE_RE.test(e.name),
      isSymlink: st.isSymbolicLink(),
      hidden: e.name.startsWith('.'),
      bytes: isDir ? null : allocated(st),
      mtimeMs: st.mtimeMs,
      dev: st.dev,
    });
  }
  return { dir, children };
}

module.exports = { sizeOf, listDir, allocated, PROTECTED_NAMES };
