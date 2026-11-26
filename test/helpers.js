'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Create a throwaway "home folder" with the given relative files ({ 'a/b.txt': bytes }). */
function makeTree(files = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'silt-test-')));
  for (const [rel, size] of Object.entries(files)) {
    const full = path.join(root, rel);
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.alloc(size, 1));
  }
  return root;
}

function rm(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = { makeTree, rm };
