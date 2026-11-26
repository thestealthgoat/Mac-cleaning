'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluate, grade } = require('../src/core/evaluate');

const GB = 1e9;
const cap = (free, purgeable = 0) => ({ total: 1000 * GB, free, purgeable, availableWithPurgeable: free + purgeable });

test('very low free space is critical and scores low', () => {
  const r = evaluate({ capacity: cap(8 * GB) });
  assert.equal(r.findings[0].id, 'free-critical');
  assert.ok(r.score < 40, `score ${r.score}`);
  assert.equal(grade(r.score).tone, 'bad');
});

test('plenty of free space scores healthy with no warnings', () => {
  const r = evaluate({ capacity: cap(400 * GB), apfs: { volumes: [{ role: 'Preboot', bytes: 4 * GB }] } });
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.ok(!r.findings.some((f) => f.severity !== 'info'));
});

test('score improves as free space grows', () => {
  let prev = -1;
  for (const free of [5, 20, 60, 120, 250]) {
    const s = evaluate({ capacity: cap(free * GB) }).score;
    assert.ok(s >= prev, `free ${free}GB → ${s} (prev ${prev})`);
    prev = s;
  }
});

test('flags bloated Preboot, VM and Time Machine snapshots', () => {
  const r = evaluate({
    capacity: cap(200 * GB),
    apfs: { volumes: [{ role: 'Preboot', bytes: 16 * GB }, { role: 'VM', bytes: 12 * GB }] },
    snapshots: { snapshots: Array.from({ length: 7 }, () => ({ kind: 'timemachine' })) },
  });
  const ids = r.findings.map((f) => f.id);
  assert.ok(ids.includes('preboot'));
  assert.ok(ids.includes('vm'));
  const tm = r.findings.find((f) => f.id === 'tm-snapshots');
  assert.equal(tm.severity, 'warning');
  assert.equal(tm.action.type, 'command');
});

test('turns large cleanable catalog items into actionable findings', () => {
  const hidden = {
    totals: { reclaimableSafe: 30 * GB },
    items: [
      { id: 'xcode-deriveddata', name: 'Xcode DerivedData', cleanable: true, safety: 'safe', uniqueBytes: 25 * GB, why: '...', paths: [] },
      { id: 'npm-cache', name: 'npm cache', cleanable: true, safety: 'safe', uniqueBytes: 2 * GB, command: 'npm cache clean --force', why: '...', paths: [] },
      { id: 'tiny', name: 'Tiny', cleanable: true, safety: 'safe', uniqueBytes: 0.1 * GB, why: '...', paths: [] },
    ],
  };
  const r = evaluate({ capacity: cap(200 * GB), hidden });
  const dd = r.findings.find((f) => f.itemId === 'xcode-deriveddata');
  assert.equal(dd.severity, 'warning');
  assert.deepEqual(dd.action, { type: 'clean', itemId: 'xcode-deriveddata' });
  assert.equal(r.findings.find((f) => f.itemId === 'npm-cache').action.type, 'command');
  assert.ok(!r.findings.some((f) => f.itemId === 'tiny'));
  // More junk → lower score than the same disk without it.
  assert.ok(r.score < evaluate({ capacity: cap(200 * GB) }).score);
});

test('mentions Full Disk Access when missing', () => {
  const r = evaluate({ capacity: cap(200 * GB), fullDiskAccess: false });
  assert.ok(r.findings.some((f) => f.id === 'fda'));
});
