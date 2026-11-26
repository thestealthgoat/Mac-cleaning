'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatBytes, percent, formatAge } = require('../src/core/format');
const { matchesInstalledApp } = require('../src/core/apps');
const { buildMarkdownReport } = require('../src/core/report');

test('formatBytes uses decimal units like Finder', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1500), '1.5 KB');
  assert.equal(formatBytes(20_191_756_288), '20.2 GB');
  assert.equal(formatBytes(994_662_584_320), '995 GB');
  assert.equal(formatBytes(null), '—');
  assert.equal(percent(25, 100), '25%');
});

test('formatAge', () => {
  const now = Date.UTC(2026, 0, 31);
  assert.equal(formatAge(now - 1000, now), 'today');
  assert.equal(formatAge(now - 86400000 * 3, now), '3 days ago');
  assert.equal(formatAge(now - 86400000 * 400, now), '1 year ago');
});

test('leftover-app heuristic', () => {
  const apps = { names: ['propresenter', 'slack', 'xcode', 'studioone'], ids: ['com.renewedvision.propresenter', 'com.tinyspeck.slackmacgap', 'com.presonus.studioone5'] };
  assert.ok(matchesInstalledApp('RenewedVision', apps), 'vendor match');
  assert.ok(matchesInstalledApp('Slack', apps), 'name match');
  assert.ok(matchesInstalledApp('com.tinyspeck.slackmacgap', apps), 'bundle id match');
  assert.ok(matchesInstalledApp('com.apple.wallpaper', apps), 'system folders never flagged');
  assert.ok(matchesInstalledApp('PreSonus', apps));
  assert.ok(!matchesInstalledApp('SomeDeletedApp', apps));
  assert.ok(!matchesInstalledApp('com.oldvendor.gone', apps));
});

test('report hides the home folder path', () => {
  const md = buildMarkdownReport({
    machine: { model: 'Mac', macos: '26.0' },
    capacity: { total: 1e12, free: 1e11, purgeable: 0, availableWithPurgeable: 1e11 },
    evaluation: { score: 80, findings: [] },
    hidden: {
      totals: { explained: 1e9, reclaimableSafe: 1e9, reclaimableReview: 0 },
      items: [{ name: 'App caches', bytes: 1e9, safety: 'safe', paths: [{ path: '/Users/jdoe/Library/Caches', bytes: 1e9 }] }],
    },
    home: '/Users/jdoe',
  });
  assert.ok(md.includes('~/Library/Caches'));
  assert.ok(!md.includes('/Users/jdoe'));
});

test('squarified treemap fills the box', async () => {
  const { squarify } = await import('../src/renderer/ui.js');
  const rects = squarify([{ value: 6 }, { value: 6 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 2 }, { value: 1 }], 600, 400);
  assert.equal(rects.length, 7);
  const area = rects.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(Math.abs(area - 600 * 400) < 1e-6);
  for (const r of rects) {
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 600 + 1e-6 && r.y + r.h <= 400 + 1e-6);
  }
});
