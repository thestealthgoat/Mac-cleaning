'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../src/core/apps-folder');
const { breakdown } = require('../src/core/breakdown');

const GB = 1e9;

test('lists non-app folders in the Applications folder and tells them apart from app folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'silt-apps-'));
  for (const d of ['Big.app/Contents', 'KeyScapes/Spectrasonics Downloads/Data', 'Office/Word.app/Contents', 'Waves/Data', 'Vendor/Setup.app/Contents']) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'manual.pdf'), 'x');
  const j = (p) => path.join(root, p);
  const sizes = new Map([
    [root, { bytes: 150 * GB }],
    [j('Big.app'), { bytes: 5 * GB }],
    [j('KeyScapes'), { bytes: 75 * GB }],
    [j('Office'), { bytes: 2 * GB }],
    [j('Office/Word.app'), { bytes: 2 * GB }],
    [j('Waves'), { bytes: 60 * GB }],
    [j('Vendor'), { bytes: 8 * GB }],
    [j('Vendor/Setup.app'), { bytes: 0.01 * GB }],
    [j('manual.pdf'), { bytes: 0.05 * GB }],
  ]);
  const r = F.listAppsFolder(sizes, root);
  const kind = Object.fromEntries(r.items.map((i) => [i.name, i.kind]));
  assert.deepStrictEqual(kind, { KeyScapes: 'content', Waves: 'content', Vendor: 'content', Big: 'app', Office: 'app-folder', 'manual.pdf': 'file' });
  assert.strictEqual(r.total, 150 * GB);
  assert.strictEqual(Math.round(r.notApps / 1e7), Math.round((75 + 60 + 8 + 0.05) * 100));
  fs.rmSync(root, { recursive: true, force: true });
});

test('finds side-by-side versions', () => {
  const v = F.versionedFolders('/Applications/Waves', ['Applications V16', 'Applications V17', 'Plug-Ins V16', 'Plug-Ins V17', 'Data', 'WaveShells V16']);
  assert.strictEqual(v.latest, 17);
  assert.deepStrictEqual(v.older, [{ version: 16, paths: ['/Applications/Waves/Applications V16', '/Applications/Waves/Plug-Ins V16', '/Applications/Waves/WaveShells V16'] }]);
  assert.strictEqual(F.versionedFolders('/x', ['Data', 'Plug-Ins V17']), null);
});

test('installer copies: big files that already exist elsewhere', () => {
  const inst = '/Applications/KeyScapes';
  const lib = '/Users/t/Library/Application Support/Spectrasonics/STEAM/Keyscape';
  const files = [
    { path: `${inst}/Data/Full/STEAM/Keyscape/Soundsources/A.db`, size: 6e9, bytes: 6e9 },
    { path: `${inst}/Data/Full/STEAM/Keyscape/Soundsources/B.db`, size: 4e9, bytes: 4e9 },
    { path: `${inst}/Data/Other.zip`, size: 1e8, bytes: 1e8 },
    { path: `${lib}/Soundsources/A.db`, size: 6e9, bytes: 6e9 },
    { path: `${lib}/Soundsources/B.db`, size: 4e9, bytes: 4e9 },
    { path: '/Users/t/Downloads/Unrelated/C.db', size: 3e9, bytes: 3e9 },
  ];
  const r = F.installerCopies(files, [inst, '/Users/t/Downloads/Unrelated']);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].path, inst);
  assert.strictEqual(r[0].matchedBytes, 10e9);
  assert.strictEqual(r[0].installedAt, `${lib}/Soundsources`);
  assert.strictEqual(r[0].files, 2);
  // Same name but different size is not a match.
  files[3].size = 1;
  files[4].size = 2;
  assert.deepStrictEqual(F.installerCopies(files, [inst]), []);
});

test('disk breakdown is measured, non-overlapping and adds up to used space', () => {
  const capacity = { total: 995 * GB, free: 44 * GB };
  const apfs = { volumes: [{ role: 'System', bytes: 17 * GB }, { role: 'Preboot', bytes: 16 * GB }, { role: 'VM', bytes: 2 * GB }, { role: 'Recovery', bytes: 3 * GB }] };
  const r = breakdown({ capacity, apfs, applications: 188 * GB, systemData: 339 * GB, homeFiles: 300 * GB, homeClaims: 70 * GB });
  const by = Object.fromEntries(r.segments.map((s) => [s.id, s.bytes]));
  assert.strictEqual(by.files, 230 * GB); // the sound library in ~/Music is counted once, under System Data
  assert.strictEqual(by.volumes, 21 * GB);
  assert.strictEqual(r.segments.reduce((s, x) => s + x.bytes, 0), 951 * GB);
  assert.strictEqual(by.other, 951 * GB - (17 + 21 + 188 + 339 + 230) * GB);
  const c = breakdown({ capacity, apfs, applications: 188 * GB, systemData: 339 * GB, homeFiles: 300 * GB, homeClaims: 70 * GB, cloud: 48 * GB });
  assert.strictEqual(c.segments.find((s) => s.id === 'other').bytes, by.other - 48 * GB);
  assert.strictEqual(r.overCounted, 0);
});
