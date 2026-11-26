'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { findProjects, groupSessions, groupDocs } = require('../src/core/projects');
const { identify, vendorKey } = require('../src/core/plugins');
const { makeTree, rm } = require('./helpers');

test('finds code projects, their rebuildable folders, and stops at the project root', () => {
  const home = makeTree({
    'Developer/web/package.json': 10,
    'Developer/web/.git/HEAD': 10,
    'Developer/web/node_modules/react/index.js': 5000,
    'Developer/web/.next/cache/x': 100,
    'Developer/web/dist/app.js': 100,
    'Developer/web/.gitignore': 0,
    'Developer/web/packages/inner/package.json': 10, // inside a project — not a separate one
    'Developer/rusty/Cargo.toml': 10,
    'Developer/rusty/target/debug/bin': 1000,
    'Developer/notes/target/README.md': 10, // "target" without Cargo.toml is not an artifact
    'Developer/notes/requirements.txt': 10,
    'Documents/package.json': 10, // a stray file in a container folder is not a project
    'Documents/real/pyproject.toml': 10,
    'Documents/real/.venv/lib/x': 100,
  });
  require('fs').writeFileSync(path.join(home, 'Developer/web/.gitignore'), 'node_modules\n/dist\n.env\n');
  try {
    const { code } = findProjects([home]);
    const byName = Object.fromEntries(code.map((c) => [c.name, c]));
    assert.deepEqual(Object.keys(byName).sort(), ['notes', 'real', 'rusty', 'web']);
    assert.deepEqual(byName.web.artifacts.map((a) => a.name).sort(), ['.next', 'dist', 'node_modules']);
    assert.ok(byName.web.kinds.includes('Git') && byName.web.kinds.includes('Node.js'));
    assert.deepEqual(byName.rusty.artifacts.map((a) => a.name), ['target']);
    assert.deepEqual(byName.notes.artifacts, [], 'target only counts for Rust/Java');
    assert.deepEqual(byName.real.artifacts.map((a) => a.name), ['.venv']);
    assert.ok(byName.web.lastActive > 0);
  } finally {
    rm(home);
  }
});

test('groups DAW sessions into project folders and finds rigs and presentations', () => {
  const home = makeTree({
    'Music/Live Set Project/Live Set.als': 100,
    'Music/Live Set Project/Live Set v2.als': 100,
    'Music/Live Set Project/Ableton Project Info/x': 10,
    'Music/Live Set Project/Backup/Live Set [old].als': 100, // backup — skipped as a session
    'Desktop/Sunday/Sunday.song': 100,
    'Desktop/Sunday/Media/a.wav': 1000,
    'Desktop/Sunday/History/old.song': 100,
    'Desktop/loose.als': 100,
    'Music/MainStage/Worship.concert/Contents/x': 100,
    'Music/Logic/Track.logicx/Alternatives/000/x': 100,
    'Dropbox/Pres/Song A.pro': 10,
    'Dropbox/Pres/Song B.pro': 10,
  });
  try {
    const found = findProjects([home]);
    const sessions = groupSessions(found.sessions);
    const live = sessions.find((s) => s.name === 'Live Set Project');
    assert.ok(live, 'Ableton project folder detected');
    assert.equal(live.versions, 2);
    assert.deepEqual(live.backups.map((b) => b.name), ['Backup']);
    const s1 = sessions.find((s) => s.app === 'Studio One');
    assert.equal(s1.path, path.join(home, 'Desktop/Sunday'));
    assert.deepEqual(s1.backups.map((b) => b.name), ['History']);
    assert.ok(sessions.find((s) => s.name === 'loose' && !s.isFolder), 'lone set stays a single file');
    assert.ok(sessions.find((s) => s.app === 'MainStage' && s.category === 'rig'));
    assert.ok(sessions.find((s) => s.app === 'Logic Pro'));
    const docs = groupDocs(found.docs);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].versions, 2);
    assert.equal(docs[0].app, 'ProPresenter');
  } finally {
    rm(home);
  }
});

test('plug-in vendor identification', () => {
  const au = identify({ file: 'Omnisphere.component' }, { CFBundleIdentifier: 'com.spectrasonics.Omnisphere', AudioComponents: [{ name: 'Spectrasonics: Omnisphere' }] });
  assert.equal(au.vendor, 'Spectrasonics');
  assert.equal(au.product, 'Omnisphere');
  assert.ok(au.fromAu);
  const aax = identify({ file: 'Pro-Q 3.aaxplugin' }, { CFBundleIdentifier: 'com.fabfilter.Pro-Q.AAX.3', CFBundleName: 'Pro-Q 3' });
  assert.equal(aax.idVendor, 'fabfilter');
  assert.equal(aax.fromAu, false);

  assert.equal(vendorKey('Valhalla DSP, LLC'), 'valhalla');
  assert.equal(vendorKey('Waves Audio'), 'waves');
  assert.equal(vendorKey('Slate Digital Connect'), 'slate');
  assert.equal(vendorKey('iZotope, Inc.'), 'izotope');
  assert.equal(vendorKey('Audio Damage'), 'audiodamage', 'leading word is kept');
});
