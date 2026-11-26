'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { CATALOG, GROUPS } = require('../src/core/catalog');
const { checkTrashable } = require('../src/core/paths');

const SAFETY = new Set(['safe', 'review', 'info']);
const ACTIONS = new Set(['trash-contents', 'trash-paths', 'command', 'none', 'empty-trash']);

test('catalog entries are well formed', () => {
  const ids = new Set();
  for (const e of CATALOG) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.match(e.id, /^[a-z0-9-]+$/, e.id);
    assert.ok(e.name && e.why && e.why.length > 20, `${e.id} needs a name and an explanation`);
    assert.ok(GROUPS[e.group], `${e.id} has unknown group ${e.group}`);
    assert.ok(SAFETY.has(e.safety), `${e.id} safety`);
    assert.ok(ACTIONS.has(e.action), `${e.id} action`);
    assert.ok(Array.isArray(e.paths) && e.paths.length, `${e.id} paths`);
    if (e.action === 'command') assert.ok(e.command, `${e.id} needs a command`);
    if (e.safety === 'info') assert.ok(e.action === 'none', `${e.id}: info items must not be cleanable`);
  }
});

test('cleanable catalog paths are never protected locations', () => {
  const home = '/Users/catalog-test';
  for (const e of CATALOG.filter((x) => x.action === 'trash-contents' || x.action === 'trash-paths')) {
    for (const p of e.paths) {
      if (p.startsWith('__')) continue;
      const abs = p.replace(/^~/, home);
      // Children of these paths are trashed; the path itself must sit outside the forbidden trees.
      const probe = e.action === 'trash-contents' ? `${abs}/child` : abs;
      const res = checkTrashable(probe.replace(/\*/g, 'x'), home);
      // Only "no longer exists" is acceptable (the probe paths are fictional).
      assert.ok(res.ok || res.reason === 'Item no longer exists.', `${e.id}: ${p} → ${res.reason}`);
    }
  }
});
