'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../src/core/history');
const { summarize } = require('../src/core/hidden');

const GB = 1e9;
const DAY = 86400000;
const scan = (at, items, free = 100 * GB) => ({ scannedAt: at, items: Object.entries(items).map(([id, bytes]) => ({ id, name: id.toUpperCase(), bytes })) });

test('first scan has nothing to compare with', () => {
  const { state, view } = H.update(H.empty(), scan(1000 * DAY, { caches: 5 * GB }), { free: 50 * GB });
  assert.strictEqual(view.changes, null);
  assert.strictEqual(state.scans.length, 1);
});

test('compares with a scan about a day old and reports growth and free space', () => {
  const t0 = 1000 * DAY;
  let st = H.update(H.empty(), scan(t0, { caches: 5 * GB, xcode: 10 * GB }), { free: 80 * GB }).state;
  st = H.update(st, scan(t0 + 0.5 * DAY, { caches: 6 * GB, xcode: 10 * GB }), { free: 79 * GB }).state;
  const { view } = H.update(st, scan(t0 + 2 * DAY, { caches: 9 * GB, xcode: 4 * GB, docker: 2 * GB }), { free: 70 * GB });
  // Baseline is the newest scan at least ~a day old (t0 + 0.5 day).
  assert.strictEqual(view.changes.since, t0 + 0.5 * DAY);
  assert.deepStrictEqual(view.changes.grew.map((c) => [c.id, c.delta]), [['caches', 3 * GB], ['docker', 2 * GB]]);
  assert.deepStrictEqual(view.changes.shrank.map((c) => [c.id, c.delta]), [['xcode', -6 * GB]]);
  assert.strictEqual(view.changes.freeDelta, -9 * GB);
  assert.strictEqual(view.changes.grew[0].name, 'CACHES');
});

test('scans within an hour replace each other; history is capped', () => {
  let st = H.empty();
  st = H.recordScan(st, { at: 0, items: {} });
  st = H.recordScan(st, { at: 30 * 60000, items: { a: 1 } });
  assert.strictEqual(st.scans.length, 1);
  assert.deepStrictEqual(st.scans[0].items, { a: 1 });
  for (let i = 1; i < 200; i++) st = H.recordScan(st, { at: i * DAY, items: {} });
  assert.strictEqual(st.scans.length, 120);
});

test('small changes are ignored', () => {
  const t0 = 1000 * DAY;
  const st = H.update(H.empty(), scan(t0, { a: 1 * GB }), {}).state;
  const { view } = H.update(st, scan(t0 + 2 * DAY, { a: 1 * GB + 10e6 }), {});
  assert.deepStrictEqual(view.changes.grew, []);
});

test('regrowth: an item cleaned and then refilled is reported', () => {
  const t0 = 1000 * DAY;
  let st = H.update(H.empty(), scan(t0, { caches: 8 * GB }), {}).state;
  st = H.recordCleanup(st, { at: t0 + 1000, source: 'catalog', id: 'caches', bytes: 8 * GB });
  st = H.update(st, scan(t0 + 2 * 3600000, { caches: 0.2 * GB }), {}).state;
  const { view } = H.update(st, scan(t0 + 4 * DAY, { caches: 3.2 * GB }), {});
  assert.ok(view.regrown.caches);
  assert.strictEqual(Math.round(view.regrown.caches.regrown / 1e8), 30);
  assert.strictEqual(view.regrown.caches.days, 4);
  assert.strictEqual(view.lifetime.freed, 8 * GB);
});

test('cleanups with no bytes are not logged; lifetime adds up', () => {
  let st = H.recordCleanup(H.empty(), { source: 'files', bytes: 0 });
  assert.strictEqual(st.cleanups.length, 0);
  st = H.recordCleanup(st, { source: 'files', bytes: 5 });
  st = H.recordCleanup(st, { source: 'uninstall', bytes: 7, name: 'X' });
  assert.deepStrictEqual(H.lifetime(st).freed, 12);
});

test('load/save round-trips and survives a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silt-hist-'));
  const file = path.join(dir, 'history.json');
  assert.deepStrictEqual(H.load(file), H.empty());
  const st = H.recordScan(H.empty(), { at: 5, items: { a: 1 } });
  H.save(file, st);
  assert.deepStrictEqual(H.load(file).scans, st.scans);
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(H.load(file), H.empty());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('summarize splits cleanable space into lasting and regrowing', () => {
  const items = [
    { id: 'c', cleanable: true, safety: 'safe', regrows: true, paths: [{ path: '/a', bytes: 10 }] },
    { id: 'r', cleanable: true, safety: 'review', regrows: false, paths: [{ path: '/b', bytes: 5 }] },
    { id: 'i', cleanable: false, safety: 'info', regrows: false, paths: [{ path: '/c', bytes: 100 }] },
  ];
  const t = summarize(items);
  assert.strictEqual(t.regrowing, 10);
  assert.strictEqual(t.lasting, 5);
});

test('flags Apple’s sound library installed in both layouts', () => {
  const { evaluate } = require('../src/core/evaluate');
  const hidden = {
    totals: { reclaimableSafe: 0 },
    items: [{ id: 'audio-content', name: 'Logic', cleanable: false, uniqueBytes: 130 * GB, safety: 'review', why: '', paths: [{ path: '/Library/Application Support/Logic', bytes: 63 * GB }, { path: '/Users/x/Music/Logic Pro Library.bundle', bytes: 65 * GB }] }],
  };
  const r = evaluate({ capacity: { total: 1000 * GB, free: 400 * GB, availableWithPurgeable: 400 * GB }, apfs: null, snapshots: null, hidden });
  const f = r.findings.find((x) => x.id === 'logic-library-twice');
  assert.ok(f);
  assert.strictEqual(f.bytes, 63 * GB);
  hidden.items[0].paths.pop();
  assert.ok(!evaluate({ capacity: { total: 1000 * GB, free: 400 * GB }, hidden }).findings.some((x) => x.id === 'logic-library-twice'));
});
