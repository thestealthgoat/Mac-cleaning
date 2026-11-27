'use strict';

const test = require('node:test');
const assert = require('node:assert');
const A = require('../src/core/attribution');

const GB = 1e9;
const H = '/Users/t';
const app = (name, id) => ({ path: `/Applications/${name}.app`, id, name, fileName: name });
const mainstage = app('MainStage', 'com.apple.mainstage3');
const keyscape = app('Keyscape', 'com.spectrasonics.keyscape');
const chrome = app('Google Chrome', 'com.google.Chrome');
const xcode = app('Xcode', 'com.apple.dt.Xcode');
const apps = [mainstage, keyscape, chrome, xcode];

test('ownerApp matches by bundle id, name, group container and alias', () => {
  assert.strictEqual(A.ownerApp('com.google.Chrome', apps), chrome);
  assert.strictEqual(A.ownerApp('com.google.Chrome.helper', apps), chrome);
  assert.strictEqual(A.ownerApp('Google Chrome', apps), chrome);
  assert.strictEqual(A.ownerApp('EQHXZ8M8AV.com.google.Chrome', apps), chrome);
  assert.strictEqual(A.ownerApp('Developer', apps), xcode);
  assert.strictEqual(A.ownerApp('com.adobe.Photoshop', apps), null);
  assert.strictEqual(A.ownerApp('ab', apps), null);
});

test('attribute splits Library folders by owner and counts each byte once', () => {
  const appFiles = new Map([
    [mainstage.path, [
      { path: mainstage.path, category: 'app' },
      { path: '/Library/Application Support/Logic', category: 'shared', group: 'Apple sound library', sharedWith: [] },
      { path: `${H}/Music/Logic Pro Library.bundle`, category: 'shared', group: 'Apple sound library', sharedWith: [] },
      { path: `${H}/Library/Caches/com.apple.mainstage3`, category: 'caches' },
    ]],
    [keyscape.path, [
      { path: keyscape.path, category: 'app' },
      { path: `${H}/Library/Application Support/Spectrasonics`, category: 'vendor', sharedWith: ['2 plug-ins'] },
    ]],
    [chrome.path, [{ path: `${H}/Library/Application Support/Google`, category: 'support' }]],
    [xcode.path, []],
  ]);
  const units = [
    { path: '/Library/Application Support/Logic', bytes: 68 * GB },
    { path: `${H}/Library/Application Support/Spectrasonics`, bytes: 80 * GB },
    { path: `${H}/Library/Application Support/Google`, bytes: 1.5 * GB },
    { path: `${H}/Library/Caches/com.apple.mainstage3`, bytes: 0.1 * GB },
    { path: `${H}/Library/Developer`, bytes: 6 * GB },
    { path: `${H}/Library/Application Support/com.apple.wallpaper`, bytes: 0.5 * GB },
    { path: '/Library/Application Support/Final Cut Pro', bytes: 1.1 * GB },
    { path: `${H}/Library/Caches/pnpm`, bytes: 1.3 * GB },
    { path: '/Library/Audio/Plug-Ins', bytes: 12 * GB },
    { path: '/Library/Application Support/Sonic Academy', bytes: 5 * GB },
    { path: `${H}/Library/Caches/tiny`, bytes: 1000 },
  ];
  const claimSize = new Map([[`${H}/Music/Logic Pro Library.bundle`, 70 * GB]]);
  const r = A.attribute({ apps, appFiles, units, claimSize, pluginDirs: ['/Library/Audio/Plug-Ins/VST3'], pluginVendors: new Set(['sonicacademy']) });
  const by = Object.fromEntries(r.owners.map((o) => [o.key, o]));

  // Only MainStage is installed from the Apple pro-audio family, so the library is MainStage's.
  assert.strictEqual(by[`app:${mainstage.path}`].bytes, 68 * GB + 70 * GB + 0.1 * GB);
  // Spectrasonics is used by Keyscape and plug-ins: shared.
  assert.strictEqual(by['vendor:Spectrasonics'].kind, 'shared');
  assert.deepStrictEqual(by['vendor:Spectrasonics'].members, ['Keyscape', 'plug-ins']);
  assert.strictEqual(by[`app:${chrome.path}`].bytes, 1.5 * GB);
  assert.strictEqual(by[`app:${xcode.path}`].bytes, 6 * GB);
  assert.strictEqual(by.apple.bytes, 0.5 * GB);
  assert.strictEqual(by.plugins.bytes, 12 * GB);
  assert.strictEqual(by.tools.bytes, 1.3 * GB);
  assert.strictEqual(by['vendor:Sonic Academy'].kind, 'shared');
  assert.deepStrictEqual(by.leftover.items.map((i) => i.path), ['/Library/Application Support/Final Cut Pro']);
  const sum = units.filter((u) => u.bytes >= 1e6).reduce((s, u) => s + u.bytes, 0) + 70 * GB;
  assert.strictEqual(r.total, sum);
  assert.strictEqual(r.perApp[mainstage.path].total, 138.1 * GB);
  assert.strictEqual(r.perApp[keyscape.path].shared, 80 * GB);
});

test('a claimed folder inside a unit is carved out of it', () => {
  const a = app('Foo', 'com.foo.app');
  const appFiles = new Map([[a.path, [{ path: '/Library/Audio/Impulse Responses/Foo', category: 'support' }]]]);
  const units = [{ path: '/Library/Audio/Impulse Responses', bytes: 10 * GB }];
  const r = A.attribute({ apps: [a], appFiles, units, claimSize: new Map([['/Library/Audio/Impulse Responses/Foo', 4 * GB]]) });
  const by = Object.fromEntries(r.owners.map((o) => [o.key, o.bytes]));
  assert.strictEqual(by[`app:${a.path}`], 4 * GB);
  assert.strictEqual(by.apple, 6 * GB);
  assert.strictEqual(r.total, 10 * GB);
});

test('roots include containers only with Full Disk Access', () => {
  assert.ok(A.roots(H, true).includes(`${H}/Library/Containers`));
  assert.ok(!A.roots(H, false).includes(`${H}/Library/Containers`));
  assert.ok(A.roots(H, false).includes('/Library/Application Support'));
});
