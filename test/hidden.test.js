'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { markNesting, summarize, measureAll, resolveEntryPaths, needsFda } = require('../src/core/hidden');
const { makeTree, rm } = require('./helpers');

function item(id, cleanable, safety, paths) {
  return { id, cleanable, safety, paths: paths.map(([p, bytes]) => ({ path: p, bytes })) };
}

test('nested paths are not double counted', () => {
  const items = [
    item('caches', true, 'safe', [['/h/Library/Caches', 1000]]),
    item('brew', true, 'safe', [['/h/Library/Caches/Homebrew', 300]]),
    item('appsupport', false, 'info', [['/h/Library/Application Support', 5000]]),
    item('electron', true, 'safe', [['/h/Library/Application Support/Slack/Cache', 200]]),
    item('downloads', true, 'review', [['/h/Downloads/x.dmg', 50]]),
  ];
  markNesting(items);
  assert.equal(items[1].paths[0].nestedIn, 'caches');
  assert.equal(items[1].paths[0].nestedInCleanable, 'caches');
  assert.equal(items[3].paths[0].nestedIn, 'appsupport');
  assert.equal(items[3].paths[0].nestedInCleanable, null, 'info items do not swallow cleanable children');

  const t = summarize(items);
  assert.equal(t.explained, 1000 + 5000 + 50);
  assert.equal(t.reclaimableSafe, 1000 + 200, 'brew counted inside caches; electron counted on its own');
  assert.equal(t.reclaimableReview, 50);
});

test('identical paths in two entries count once', () => {
  const items = [item('a', true, 'safe', [['/x', 10]]), item('b', true, 'safe', [['/x', 10]])];
  markNesting(items);
  assert.equal(items[0].paths[0].nestedIn, null);
  assert.equal(items[1].paths[0].nestedIn, 'a');
  assert.equal(summarize(items).reclaimableSafe, 10);
});

test('measureAll measures nested paths from one du pass', async () => {
  const root = makeTree({ 'a/one': 100_000, 'a/b/two': 200_000, 'a/b/c/three': 300_000, 'file.bin': 50_000 });
  try {
    const sizes = await measureAll([path.join(root, 'a'), path.join(root, 'a/b/c'), path.join(root, 'file.bin')]);
    const a = sizes.get(path.join(root, 'a')).bytes;
    const c = sizes.get(path.join(root, 'a/b/c')).bytes;
    assert.ok(a >= 600_000, `a=${a}`);
    assert.ok(c >= 300_000 && c < a, `c=${c}`);
    assert.ok(sizes.get(path.join(root, 'file.bin')).bytes >= 50_000);
  } finally {
    rm(root);
  }
});

test('protected folders are skipped without Full Disk Access', () => {
  const home = '/Users/someone';
  assert.ok(needsFda('/Users/someone/Library/Containers/com.docker.docker', home));
  assert.ok(needsFda('/Users/someone/Library/Mail', home));
  assert.ok(!needsFda('/Users/someone/Library/Caches', home));
  const entry = { paths: ['~/Library/Containers/com.docker.docker/Data/vms', '~/Library/Caches'] };
  const r = resolveEntryPaths(entry, home, { fullDiskAccess: false });
  assert.equal(r.skipped.length, 1);
});
