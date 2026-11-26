'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Settings = require('../src/main/settings');
const { makeTree, rm } = require('./helpers');

test('settings default, persist, and reject unknown keys', () => {
  const dir = makeTree({});
  try {
    const s = Settings.create(dir);
    assert.equal(s.get('autoUpdate'), true, 'auto-update is on by default');
    s.set('autoUpdate', false);
    assert.equal(Settings.create(dir).get('autoUpdate'), false, 'persisted to disk');
    assert.throws(() => s.set('autoUpdate', 'no'), /Invalid setting/);
    assert.throws(() => s.set('telemetry', true), /Invalid setting/);
    fs.writeFileSync(path.join(dir, 'settings.json'), '{not json');
    assert.equal(Settings.create(dir).get('autoUpdate'), true, 'corrupt file falls back to defaults');
  } finally {
    rm(dir);
  }
});
