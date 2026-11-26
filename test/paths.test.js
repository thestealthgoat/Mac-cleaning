'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { expandHome, expandGlob, isWithin, checkTrashable, segmentToRegExp } = require('../src/core/paths');
const { makeTree, rm } = require('./helpers');

test('expandHome', () => {
  assert.equal(expandHome('~', '/Users/x'), '/Users/x');
  assert.equal(expandHome('~/Library', '/Users/x'), '/Users/x/Library');
  assert.equal(expandHome('/etc', '/Users/x'), '/etc');
});

test('segmentToRegExp escapes regex characters', () => {
  assert.ok(segmentToRegExp('*.dmg').test('Foo.dmg'));
  assert.ok(!segmentToRegExp('*.dmg').test('Foo.dmgx'));
  assert.ok(segmentToRegExp('Install macOS*.app').test('Install macOS Sequoia.app'));
  assert.ok(!segmentToRegExp('a+b').test('aab'));
});

test('expandGlob matches wildcards in any segment', () => {
  const home = makeTree({
    'Library/Application Support/Slack/Cache/x': 10,
    'Library/Application Support/Discord/Cache/y': 10,
    'Library/Application Support/Other/Data/z': 10,
    'Downloads/a.dmg': 5,
    'Downloads/b.pkg': 5,
    'Downloads/c.txt': 5,
  });
  try {
    const caches = expandGlob('~/Library/Application Support/*/Cache', home).map((p) => path.relative(home, p)).sort();
    assert.deepEqual(caches, ['Library/Application Support/Discord/Cache', 'Library/Application Support/Slack/Cache']);
    const dmgs = expandGlob('~/Downloads/*.dmg', home);
    assert.equal(dmgs.length, 1);
    assert.equal(expandGlob('~/Nope/*', home).length, 0);
  } finally {
    rm(home);
  }
});

test('isWithin', () => {
  assert.ok(isWithin('/a/b/c', '/a/b'));
  assert.ok(isWithin('/a/b', '/a/b'));
  assert.ok(!isWithin('/a/bc', '/a/b'));
  assert.ok(!isWithin('/a', '/a/b'));
});

test('checkTrashable allows normal items in home, blocks protected ones', () => {
  const home = makeTree({
    'Library/Caches/com.example/file': 10,
    'Documents/report.pdf': 10,
    'Library/Mobile Documents/com~apple~CloudDocs/x': 10,
    'Library/Keychains/login.keychain-db': 10,
  });
  try {
    assert.ok(checkTrashable(path.join(home, 'Library/Caches/com.example'), home).ok);
    assert.ok(checkTrashable(path.join(home, 'Documents/report.pdf'), home).ok);

    for (const p of ['', 'Library', 'Library/Caches', 'Documents', 'Desktop', '.Trash']) {
      assert.equal(checkTrashable(path.join(home, p), home).ok, false, `should protect ~/${p}`);
    }
    assert.equal(checkTrashable(path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs/x'), home).ok, false);
    assert.equal(checkTrashable(path.join(home, 'Library/Keychains/login.keychain-db'), home).ok, false);
    assert.equal(checkTrashable(path.join(home, 'Library/Caches/../Keychains'), home).ok, false, 'rejects ..');
    assert.equal(checkTrashable('relative/path', home).ok, false);
    assert.equal(checkTrashable(path.join(home, 'does-not-exist'), home).ok, false);
  } finally {
    rm(home);
  }
});

test('checkTrashable never allows system locations', () => {
  for (const p of ['/', '/System', '/System/Library/CoreServices', '/usr/bin/du', '/Library', '/Applications', '/private/var/vm', '/etc/hosts']) {
    assert.equal(checkTrashable(p, '/Users/nobody-here').ok, false, p);
  }
});

test('checkTrashable allows whole apps but not files inside them', () => {
  // /Applications/Safari.app exists on every Mac but is on the sealed system volume via firmlink;
  // we only assert the shape rule here.
  assert.equal(checkTrashable('/Applications/Safari.app/Contents', '/Users/nobody-here').ok, false);
});
