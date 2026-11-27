'use strict';

/**
 * Storage history: a small local log of past System Data scans and of what
 * Silt cleaned. It answers the questions one-off cleaners can't:
 *   - what grew since last time?
 *   - did that cache come straight back after I cleaned it?
 *   - how much has Silt freed overall?
 *
 * Stored as JSON in the app's user-data folder. It never leaves the Mac.
 */
const fs = require('fs');
const path = require('path');

const MAX_SCANS = 120;
const MAX_CLEANUPS = 500;
const MERGE_WINDOW_MS = 60 * 60 * 1000; // scans within an hour replace each other
const BASELINE_AGE_MS = 20 * 60 * 60 * 1000; // compare with a scan at least ~a day old
const MIN_BASELINE_AGE_MS = 10 * 60 * 1000;
const NOTABLE_BYTES = 50 * 1024 * 1024;

const empty = () => ({ version: 1, scans: [], cleanups: [] });

function load(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...empty(), ...data, scans: Array.isArray(data.scans) ? data.scans : [], cleanups: Array.isArray(data.cleanups) ? data.cleanups : [] };
  } catch {
    return empty();
  }
}

function save(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

/** Compact snapshot of one scan: item id → bytes, plus free space. */
function snapshotFrom(hidden, capacity, at = hidden?.scannedAt ?? Date.now()) {
  const items = {};
  for (const i of hidden?.items ?? []) if (i.bytes > 0) items[i.id] = i.bytes;
  return { at, free: capacity?.free ?? null, total: capacity?.total ?? null, items };
}

/** Add a scan. A scan within an hour of the previous one replaces it. */
function recordScan(state, snap) {
  const scans = [...state.scans];
  const last = scans[scans.length - 1];
  if (last && snap.at - last.at < MERGE_WINDOW_MS && snap.at >= last.at) scans[scans.length - 1] = snap;
  else scans.push(snap);
  return { ...state, scans: scans.slice(-MAX_SCANS) };
}

/** Log a cleanup: { at, source, id?, name?, bytes, count }. */
function recordCleanup(state, entry) {
  if (!entry || !(entry.bytes > 0)) return state;
  const clean = { at: entry.at ?? Date.now(), source: entry.source || 'other', id: entry.id ?? null, name: entry.name ?? null, bytes: entry.bytes, count: entry.count ?? 0 };
  return { ...state, cleanups: [...state.cleanups, clean].slice(-MAX_CLEANUPS) };
}

/**
 * The scan to compare against: the newest one at least ~a day older than
 * `snap`; failing that, the oldest scan that is at least 10 minutes older.
 */
function baselineFor(state, snap) {
  const older = state.scans.filter((s) => s.at < snap.at - MIN_BASELINE_AGE_MS);
  if (!older.length) return null;
  const dayOld = older.filter((s) => s.at <= snap.at - BASELINE_AGE_MS);
  return dayOld.length ? dayOld[dayOld.length - 1] : older[0];
}

/**
 * What changed between the baseline and `snap`.
 * `names` maps item id → display name.
 */
function compare(state, snap, names = {}) {
  const base = baselineFor(state, snap);
  if (!base) return null;
  const ids = new Set([...Object.keys(base.items), ...Object.keys(snap.items)]);
  const changes = [];
  for (const id of ids) {
    const before = base.items[id] ?? 0;
    const after = snap.items[id] ?? 0;
    const delta = after - before;
    if (Math.abs(delta) >= NOTABLE_BYTES) changes.push({ id, name: names[id] ?? id, before, after, delta });
  }
  changes.sort((a, b) => b.delta - a.delta);
  // Silt's own cleanups explain some of the shrinkage.
  const cleanedSince = state.cleanups.filter((c) => c.at > base.at && c.at <= snap.at).reduce((s, c) => s + c.bytes, 0);
  return {
    since: base.at,
    freeBefore: base.free,
    freeAfter: snap.free,
    freeDelta: base.free != null && snap.free != null ? snap.free - base.free : null,
    grew: changes.filter((c) => c.delta > 0),
    shrank: changes.filter((c) => c.delta < 0).reverse(),
    cleanedSince,
  };
}

/**
 * Items that came back after Silt cleaned them: the latest cleanup of each
 * item, the size at the first scan after it, and the size now.
 */
function regrowth(state, snap, minBytes = 100 * 1024 * 1024) {
  const latest = new Map();
  for (const c of state.cleanups) if (c.id && c.source === 'catalog') latest.set(c.id, c);
  const out = {};
  for (const [id, c] of latest) {
    const after = state.scans.find((s) => s.at > c.at && s.at < snap.at);
    if (!after) continue;
    const start = after.items[id] ?? 0;
    const now = snap.items[id] ?? 0;
    if (now - start >= minBytes) out[id] = { cleanedAt: c.at, freed: c.bytes, regrown: now - start, days: Math.max(1, Math.round((snap.at - c.at) / 86400000)) };
  }
  return out;
}

/** Totals for the About/Overview pages. */
function lifetime(state) {
  const freed = state.cleanups.reduce((s, c) => s + c.bytes, 0);
  return { freed, cleanups: state.cleanups.length, firstScan: state.scans[0]?.at ?? null, scans: state.scans.length };
}

/** Free-space series for a sparkline: [{ at, free }]. */
function freeSeries(state, limit = 30) {
  return state.scans.filter((s) => s.free != null).slice(-limit).map((s) => ({ at: s.at, free: s.free }));
}

/**
 * Record a fresh scan and return everything the UI shows about history.
 * Pure apart from `state`; the caller saves the returned state.
 */
function update(state, hidden, capacity) {
  const snap = snapshotFrom(hidden, capacity);
  const names = Object.fromEntries((hidden?.items ?? []).map((i) => [i.id, i.name]));
  const changes = compare(state, snap, names);
  const regrown = regrowth(state, snap);
  const next = recordScan(state, snap);
  return { state: next, view: { changes, regrown, lifetime: lifetime(next), free: freeSeries(next) } };
}

module.exports = { load, save, snapshotFrom, recordScan, recordCleanup, baselineFor, compare, regrowth, lifetime, freeSeries, update, empty, NOTABLE_BYTES };
