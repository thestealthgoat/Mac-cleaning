'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { trashPaths, planCatalogClean } = require('../src/core/cleanup');
const { makeTree, rm } = require('./helpers');

test('trashPaths only trashes allowed paths and reports the rest', async () => {
  const home = makeTree({ 'Downloads/old.dmg': 1000, 'Library/Caches/x/y': 10 });
  const trashed = [];
  try {
    const res = await trashPaths([path.join(home, 'Downloads/old.dmg'), path.join(home, 'Library/Caches'), '/System/Library', path.join(home, 'Library/Caches/x')], {
      home,
      trashItem: async (p) => trashed.push(p),
    });
    assert.deepEqual(trashed, [path.join(home, 'Downloads/old.dmg'), path.join(home, 'Library/Caches/x')]);
    assert.equal(res.moved, 2);
    assert.equal(res.failed, 2);
    assert.ok(res.results.find((r) => r.path === '/System/Library').reason);
  } finally {
    rm(home);
  }
});

test('trashPaths reports errors from the trash function', async () => {
  const home = makeTree({ 'a.txt': 10 });
  try {
    const res = await trashPaths([path.join(home, 'a.txt')], { home, trashItem: async () => Promise.reject(new Error('nope')) });
    assert.equal(res.moved, 0);
    assert.equal(res.results[0].reason, 'nope');
  } finally {
    rm(home);
  }
});

test('planCatalogClean targets folder contents, never the folder itself', () => {
  const home = makeTree({ 'Library/Caches/com.a/f': 10, 'Library/Caches/com.b/g': 10, 'Library/Caches/.DS_Store': 1 });
  try {
    const { targets } = planCatalogClean('user-caches', { home });
    assert.deepEqual(targets.map((t) => path.basename(t)).sort(), ['com.a', 'com.b']);
    assert.ok(!targets.includes(path.join(home, 'Library/Caches')));
  } finally {
    rm(home);
  }
});

test('planCatalogClean honours minimum age', () => {
  const home = makeTree({ 'Library/Logs/old.log': 10, 'Library/Logs/new.log': 10 });
  try {
    const old = new Date(Date.now() - 30 * 86400000);
    fs.utimesSync(path.join(home, 'Library/Logs/old.log'), old, old);
    const { targets } = planCatalogClean('user-logs', { home });
    assert.deepEqual(targets.map((t) => path.basename(t)), ['old.log']);
  } finally {
    rm(home);
  }
});

test('planCatalogClean refuses informational and command-only items', () => {
  assert.throws(() => planCatalogClean('ios-backups'), /cannot be cleaned/);
  assert.throws(() => planCatalogClean('docker'), /cannot be cleaned/);
  assert.throws(() => planCatalogClean('nope'), /Unknown item/);
});
