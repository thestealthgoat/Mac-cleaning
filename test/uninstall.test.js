'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const u = require('../src/core/uninstall');
const { makeTree, rm } = require('./helpers');

function fakeApp(home, name, id, extra = {}) {
  return { path: path.join(home, 'Applications', `${name}.app`), id, name, fileName: name, executable: name, ...extra };
}

test('finds an app’s files and keeps documents unselected', () => {
  const home = makeTree({
    'Applications/Tool.app/Contents/Info.plist': 10,
    'Library/Application Support/com.acme.tool/db': 100,
    'Library/Application Support/Tool/cache': 100,
    'Library/Caches/com.acme.tool/x': 100,
    'Library/Preferences/com.acme.tool.plist': 10,
    'Library/Preferences/com.other.app.plist': 10,
    'Library/Saved Application State/com.acme.tool.savedState/w': 10,
    'Library/LaunchAgents/com.acme.tool.helper.plist': 10,
    'Library/Logs/DiagnosticReports/Tool-2026-01-01.ips': 10,
    'Library/Application Support/Toolbox/x': 10, // similar name, different app — must not match
  });
  try {
    const app = fakeApp(home, 'Tool', 'com.acme.tool');
    const items = u.classify(u.findAppFiles(app, { home, installed: [app] }));
    const rel = items.map((i) => path.relative(home, i.path)).sort();
    assert.deepEqual(rel, [
      'Applications/Tool.app',
      'Library/Application Support/Tool',
      'Library/Application Support/com.acme.tool',
      'Library/Caches/com.acme.tool',
      'Library/LaunchAgents/com.acme.tool.helper.plist',
      'Library/Logs/DiagnosticReports/Tool-2026-01-01.ips',
      'Library/Preferences/com.acme.tool.plist',
      'Library/Saved Application State/com.acme.tool.savedState',
    ]);
    assert.ok(items.every((i) => i.checked), 'exclusive files are selected');
  } finally {
    rm(home);
  }
});

test('vendor folders are kept when other software from the vendor is installed', () => {
  const home = makeTree({
    'Applications/Acme Hub.app/Contents/Info.plist': 10,
    'Library/Application Support/Acme Audio/presets': 100,
  });
  try {
    const hub = fakeApp(home, 'Acme Hub', 'com.acmeaudio.hub');
    const plugins = [{ vendor: 'Acme Audio', idVendor: 'acmeaudio', name: 'Crusher', paths: [] }];
    const items = u.classify(u.findAppFiles(hub, { home, installed: [hub], plugins }));
    const vendor = items.find((i) => i.category === 'vendor');
    assert.ok(vendor, 'vendor folder found');
    assert.equal(vendor.checked, false);
    assert.match(vendor.note, /1 plug-in/);

    const alone = u.classify(u.findAppFiles(hub, { home, installed: [hub], plugins: [] }));
    assert.equal(alone.find((i) => i.category === 'vendor').checked, true, 'nothing else uses it → selected');
  } finally {
    rm(home);
  }
});

test('Apple sound library is shared between MainStage and Logic', () => {
  const home = makeTree({ 'Music/Audio Music Apps/Patches/x': 100, 'Music/MainStage/Set.concert/x': 100 });
  try {
    const ms = fakeApp(home, 'MainStage', 'com.apple.mainstage3');
    const logic = fakeApp(home, 'Logic Pro', 'com.apple.logic10');
    const withLogic = u.classify(u.findAppFiles(ms, { home, installed: [ms, logic] }));
    const lib = withLogic.find((i) => i.path.endsWith('Audio Music Apps'));
    assert.deepEqual(lib.shared, ['Logic Pro']);
    assert.equal(lib.checked, false);
    const docs = withLogic.find((i) => i.category === 'documents');
    assert.equal(docs.checked, false);

    const alone = u.classify(u.findAppFiles(ms, { home, installed: [ms] }));
    assert.equal(alone.find((i) => i.path.endsWith('Audio Music Apps')).checked, true);
  } finally {
    rm(home);
  }
});

test('checkUninstallable only allows known per-app locations', () => {
  const home = makeTree({ 'Library/Caches/com.x/a': 1, 'Library/Caches/com.x/deep/b': 1, 'Library/Keychains/k': 1, 'Documents/Thing/a': 1 });
  try {
    assert.ok(u.checkUninstallable(path.join(home, 'Library/Caches/com.x'), home).ok);
    assert.equal(u.checkUninstallable(path.join(home, 'Library/Caches/com.x/deep'), home).ok, false, 'only one level below');
    assert.equal(u.checkUninstallable(path.join(home, 'Library/Caches'), home).ok, false);
    assert.equal(u.checkUninstallable(path.join(home, 'Library/Keychains/k'), home).ok, false);
    assert.equal(u.checkUninstallable('/System/Applications/Safari.app', home).ok, false);
    assert.equal(u.checkUninstallable('/Library', home).ok, false);
    assert.equal(u.checkUninstallable(path.join(home, 'Library/Caches/../Keychains/k'), home).ok, false);
  } finally {
    rm(home);
  }
});

test('the move script quotes awkward names and really moves files (run without admin)', () => {
  const home = makeTree({ '.Trash/': 0, [`Library/Caches/it's "odd" \\ name/f`]: 10 });
  try {
    const target = path.join(home, `Library/Caches/it's "odd" \\ name`);
    const script = u.adminAppleScript([target], { home, admin: false, stamp: new Date(0) });
    execFileSync('/usr/bin/osascript', ['-e', script]);
    assert.ok(!fs.existsSync(target), 'moved away');
    const trashed = fs.readdirSync(path.join(home, '.Trash'));
    assert.equal(trashed.length, 1);
    assert.ok(trashed[0].startsWith(`it's "odd" \\ name (uninstalled`));
  } finally {
    rm(home);
  }
});
