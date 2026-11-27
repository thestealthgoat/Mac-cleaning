'use strict';

const test = require('node:test');
const assert = require('node:assert');
const F = require('../src/core/plugin-formats');
const u = require('../src/core/uninstall');
const { CATALOG } = require('../src/core/catalog');

const vendors = [
  {
    name: 'FabFilter',
    plugins: [
      {
        name: 'Pro-Q 3',
        formats: ['AU', 'VST3', 'AAX', 'VST'],
        files: [
          { path: '/Library/Audio/Plug-Ins/Components/FabFilter Pro-Q 3.component', format: 'AU', bytes: 30 },
          { path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3', format: 'VST3', bytes: 30 },
          { path: '/Library/Application Support/Avid/Audio/Plug-Ins/FabFilter/FabFilter Pro-Q 3.aaxplugin', format: 'AAX', bytes: 40 },
          { path: '/Library/Audio/Plug-Ins/VST/FabFilter Pro-Q 3.vst', format: 'VST', bytes: 20 },
        ],
      },
      { name: 'Only AAX', formats: ['AAX'], files: [{ path: '/Library/Application Support/Avid/Audio/Plug-Ins/Only.aaxplugin', format: 'AAX', bytes: 5 }] },
    ],
  },
];

test('Logic/MainStage only: VST, VST3 and AAX are unused, AU never is', () => {
  const r = F.analyze(vendors, { names: ['logicpro', 'mainstage', 'safari'], ids: [] });
  assert.deepStrictEqual(r.hosts, ['Logic Pro', 'MainStage']);
  assert.deepStrictEqual(r.unused.map((g) => [g.format, g.count, g.bytes]), [['AAX', 2, 45], ['VST3', 1, 30], ['VST', 1, 20]]);
  const aax = r.unused[0];
  assert.deepStrictEqual(aax.items.find((i) => i.plugin === 'Only AAX').otherFormats, []);
  assert.ok(!r.unused.some((g) => g.format === 'AU'));
});

test('hosts that cover every format leave nothing unused', () => {
  const r = F.analyze(vendors, { names: ['protools', 'abletonlive12suite'], ids: [] });
  assert.deepStrictEqual(r.unused, []);
});

test('no recognised host: suggest nothing', () => {
  const r = F.analyze(vendors, { names: ['safari'], ids: [] });
  assert.strictEqual(r.noHosts, true);
  assert.deepStrictEqual(r.unused, []);
});

test('only bundles of the right format inside plug-in folders are removable', () => {
  const dirs = ['/Library/Audio/Plug-Ins/VST3', '/Library/Application Support/Avid/Audio/Plug-Ins'];
  assert.ok(F.isRemovablePluginBundle('/Library/Audio/Plug-Ins/VST3/X.vst3', 'VST3', dirs));
  assert.ok(F.isRemovablePluginBundle('/Library/Application Support/Avid/Audio/Plug-Ins/Vendor/X.aaxplugin', 'AAX', dirs));
  assert.ok(!F.isRemovablePluginBundle('/Library/Audio/Plug-Ins/VST3/X.vst3', 'AAX', dirs));
  assert.ok(!F.isRemovablePluginBundle('/Library/Audio/Plug-Ins/VST3', 'VST3', dirs));
  assert.ok(!F.isRemovablePluginBundle('/Library/Audio/Plug-Ins/VST3/../../X.vst3', 'VST3', dirs));
  assert.ok(!F.isRemovablePluginBundle('/Users/x/Music/X.vst3', 'VST3', dirs));
  assert.ok(!F.isRemovablePluginBundle('/Library/Audio/Plug-Ins/Components/X.component', 'AU', ['/Library/Audio/Plug-Ins/Components']));
});

test('mdls dates parse; unknown stays null', () => {
  const out = '2026-11-26 23:33:34 +0000\0(null)\0' + '2025-01-02 03:04:05 -0500';
  const d = u.parseMdlsDates(out, 3);
  assert.strictEqual(d[0], Date.UTC(2026, 10, 26, 23, 33, 34));
  assert.strictEqual(d[1], null);
  assert.strictEqual(d[2], Date.UTC(2025, 0, 2, 8, 4, 5));
  assert.deepStrictEqual(u.parseMdlsDates('', 2), [null, null]);
});

test('admin move script never sends two items to the same Trash name', () => {
  const s = u.adminMoveScript(['/Library/A/X.vst3', '/Library/B/X.vst3'], { home: '/Users/t', uid: 501, stamp: new Date(0) });
  const dests = [...s.matchAll(/mv '[^']+' '([^']+)'/g)].map((m) => m[1]);
  assert.strictEqual(dests.length, 2);
  assert.notStrictEqual(dests[0], dests[1]);
});

test('every regrowing id is a real catalog entry', () => {
  const { REGROWS } = require('../src/core/catalog');
  const ids = new Set(CATALOG.map((e) => e.id));
  for (const id of REGROWS) assert.ok(ids.has(id), id);
  assert.strictEqual(CATALOG.find((e) => e.id === 'user-caches').regrows, true);
  assert.strictEqual(CATALOG.find((e) => e.id === 'ios-backups').regrows, false);
});

test('activity date falls back to the newest of prefs / saved state / caches', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'silt-act-'));
  const L = path.join(home, 'Library');
  fs.mkdirSync(path.join(L, 'Preferences'), { recursive: true });
  fs.mkdirSync(path.join(L, 'Caches', 'com.x.app'), { recursive: true });
  const pref = path.join(L, 'Preferences', 'com.x.app.plist');
  fs.writeFileSync(pref, '');
  fs.utimesSync(pref, new Date(1e12), new Date(1e12));
  fs.utimesSync(path.join(L, 'Caches', 'com.x.app'), new Date(2e12), new Date(2e12));
  assert.strictEqual(u.activityDate({ id: 'com.x.app' }, home), 2e12);
  assert.strictEqual(u.activityDate({ id: 'com.none' }, home), null);
  assert.strictEqual(u.activityDate({ id: '' }, home), null);
  fs.rmSync(home, { recursive: true, force: true });
});
