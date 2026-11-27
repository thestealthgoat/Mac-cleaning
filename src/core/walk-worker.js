'use strict';

/**
 * Worker thread that walks a folder tree off the main thread.
 *   mode 'large'  → biggest files above `minBytes`
 *   mode 'dupes'  → groups of files with identical content
 * Posts { type: 'progress' | 'done' | 'error', ... } messages.
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { mode, roots, minBytes = 0, limit = 500, skip = [], skipNames = [] } = workerData;

// Cancellation is done by terminating the worker from the main thread (the
// walk is synchronous, so a message listener would never get a chance to run —
// and would keep the thread alive after it finishes).
const cancelled = false;

const skipSet = new Set(skip);
// Folder names never worth descending into for big-file searches (e.g. node_modules).
const skipNameSet = new Set(skipNames);
// Never descend into these: other volumes, the sealed system, virtual filesystems,
// and cloud-backed folders where reading file contents could trigger downloads.
const ALWAYS_SKIP = ['/System', '/Volumes', '/dev', '/private/var/vm', '/private/var/db', '/cores', '/Network'];

let filesSeen = 0;
let bytesSeen = 0;
let lastPost = 0;

function progress(current, extra = {}) {
  const now = Date.now();
  if (now - lastPost < 200) return;
  lastPost = now;
  parentPort.postMessage({ type: 'progress', filesSeen, bytesSeen, current, ...extra });
}

function allocated(st) {
  return st.blocks > 0 ? st.blocks * 512 : 0;
}

/** Iterative depth-first walk. Calls onFile(fullPath, stat) for regular files. */
function walk(root, onFile) {
  const stack = [root];
  const seenInodes = new Set();
  while (stack.length && !cancelled) {
    const dir = stack.pop();
    if (skipSet.has(dir) || ALWAYS_SKIP.includes(dir)) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    progress(dir);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!skipNameSet.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      // Hard links share storage; only count each inode once.
      if (st.nlink > 1) {
        const key = `${st.dev}:${st.ino}`;
        if (seenInodes.has(key)) continue;
        seenInodes.add(key);
      }
      filesSeen++;
      const bytes = allocated(st);
      bytesSeen += bytes;
      onFile(full, st, bytes);
    }
  }
}

function largeFiles() {
  // Keep the top `limit` files; a sorted array is plenty fast for a few hundred entries.
  const top = [];
  let floor = minBytes;
  for (const root of roots) {
    walk(root, (full, st, bytes) => {
      if (bytes < floor) return;
      top.push({ path: full, bytes, size: st.size, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs });
      if (top.length > limit * 2) {
        top.sort((a, b) => b.bytes - a.bytes);
        top.length = limit;
        floor = Math.max(minBytes, top[top.length - 1].bytes);
      }
    });
  }
  top.sort((a, b) => b.bytes - a.bytes);
  return { files: top.slice(0, limit) };
}

function hashFile(file, { headOnly }) {
  const CHUNK = 64 * 1024;
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    const buf = Buffer.allocUnsafe(1024 * 1024);
    if (headOnly) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, st.size), 0);
      h.update(buf.subarray(0, n));
      if (st.size > CHUNK * 2) {
        const m = fs.readSync(fd, buf, 0, CHUNK, st.size - CHUNK);
        h.update(buf.subarray(0, m));
      }
    } else {
      let pos = 0;
      while (!cancelled) {
        const n = fs.readSync(fd, buf, 0, buf.length, pos);
        if (n <= 0) break;
        h.update(buf.subarray(0, n));
        pos += n;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function regroup(groups, keyFn, phase) {
  const out = [];
  let i = 0;
  for (const group of groups) {
    if (cancelled) break;
    const by = new Map();
    for (const f of group) {
      i++;
      progress(f.path, { phase, hashed: i });
      let key;
      try {
        key = keyFn(f);
      } catch {
        continue;
      }
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(f);
    }
    for (const g of by.values()) if (g.length > 1) out.push(g);
  }
  return out;
}

function duplicates() {
  const bySize = new Map();
  for (const root of roots) {
    walk(root, (full, st, bytes) => {
      // Dataless (cloud placeholder) files have no blocks; hashing them would download them.
      if (st.size < minBytes || bytes === 0) return;
      const k = st.size;
      if (!bySize.has(k)) bySize.set(k, []);
      bySize.get(k).push({ path: full, bytes, size: st.size, mtimeMs: st.mtimeMs });
    });
  }
  let candidates = [...bySize.values()].filter((g) => g.length > 1);
  candidates = regroup(candidates, (f) => hashFile(f.path, { headOnly: true }), 'quick-hash');
  candidates = regroup(candidates, (f) => hashFile(f.path, { headOnly: false }), 'full-hash');
  const groups = candidates
    .map((files) => {
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);
      return { size: files[0].size, bytes: files[0].bytes, files, wasted: files[0].bytes * (files.length - 1) };
    })
    .sort((a, b) => b.wasted - a.wasted);
  return { groups };
}

function projects() {
  const { findProjects, groupSessions, groupDocs } = require('./projects');
  const found = findProjects(roots, {
    skip,
    onProgress: (dir, dirs) => {
      filesSeen = dirs;
      progress(dir, { phase: 'finding' });
    },
  });
  return { code: found.code, sessions: groupSessions(found.sessions), docs: groupDocs(found.docs), dirsSeen: found.dirsSeen };
}

try {
  const started = Date.now();
  const result = mode === 'dupes' ? duplicates() : mode === 'projects' ? projects() : largeFiles();
  parentPort.postMessage({ type: 'done', cancelled, filesSeen, bytesSeen, ms: Date.now() - started, ...result });
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message });
}
